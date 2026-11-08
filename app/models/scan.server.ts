// The audit scanner.
//
// A scan walks products → collections → pages → articles one Admin API page
// at a time, writing an AuditItem per resource (and AuditImage per product
// image, LinkRef per internal link). Each call to runScanStep does as many
// pages as fit in ~15 s and returns; the dashboard keeps calling until the
// phase reaches "done", so no request outlives Vercel's function limit.
// The finalize phase works across everything scanned: duplicate titles and
// descriptions, and internal links that point at nothing.

import prisma from "../db.server";
import { gql, type AdminClient } from "./admin.server";
import { itemIssues, scoreFor, type IssueCode } from "../lib/audit";
import { htmlToText, type Resource } from "../lib/templates";
import { internalPaths } from "../lib/links";
import { can, limit, type PlanName } from "../lib/plans";

const STEP_BUDGET_MS = 15_000;
const PAGE = 40;
const PHASES: (Resource | "finalize" | "done")[] = ["product", "collection", "page", "article", "finalize", "done"];

const QUERIES: Record<Resource, string> = {
  product: `#graphql
    query SeoScanProducts($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: ID) {
        nodes {
          id title handle vendor productType descriptionHtml
          seo { title description }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          media(first: 20) {
            nodes {
              ... on MediaImage {
                id alt
                image { url width height }
                originalSource { fileSize }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  collection: `#graphql
    query SeoScanCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after, sortKey: ID) {
        nodes {
          id title handle descriptionHtml
          seo { title description }
          image { altText }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  page: `#graphql
    query SeoScanPages($first: Int!, $after: String) {
      pages(first: $first, after: $after, sortKey: ID) {
        nodes {
          id title handle body
          titleTag: metafield(namespace: "global", key: "title_tag") { value }
          descriptionTag: metafield(namespace: "global", key: "description_tag") { value }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  article: `#graphql
    query SeoScanArticles($first: Int!, $after: String) {
      articles(first: $first, after: $after, sortKey: ID) {
        nodes {
          id title handle body
          blog { title handle }
          image { altText url }
          titleTag: metafield(namespace: "global", key: "title_tag") { value }
          descriptionTag: metafield(namespace: "global", key: "description_tag") { value }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
};

const CONNECTION: Record<Resource, string> = {
  product: "products",
  collection: "collections",
  page: "pages",
  article: "articles",
};

export type ScanState = {
  status: string;
  phase: string;
  scanned: number;
  cap: number;
  error: string;
  finishedAt: string | null;
};

function view(run: { status: string; phase: string; scanned: number; cap: number; error: string; finishedAt: Date | null }): ScanState {
  return { status: run.status, phase: run.phase, scanned: run.scanned, cap: run.cap, error: run.error, finishedAt: run.finishedAt?.toISOString() ?? null };
}

export async function getScanState(shop: string): Promise<ScanState | null> {
  const run = await prisma.auditRun.findUnique({ where: { shop } });
  return run ? view(run) : null;
}

/** Starts a fresh scan, discarding the last results. */
export async function startScan(shop: string, plan: PlanName): Promise<ScanState> {
  const cap = limit(plan, "auditItems");
  await prisma.$transaction([
    prisma.auditItem.deleteMany({ where: { shop } }),
    prisma.auditImage.deleteMany({ where: { shop } }),
    prisma.linkRef.deleteMany({ where: { shop } }),
  ]);
  const run = await prisma.auditRun.upsert({
    where: { shop },
    create: { shop, status: "running", phase: "product", cursor: "", scanned: 0, cap, startedAt: new Date(), error: "" },
    update: { status: "running", phase: "product", cursor: "", scanned: 0, cap, startedAt: new Date(), finishedAt: null, error: "" },
  });
  return view(run);
}

async function shopHosts(admin: AdminClient): Promise<string[]> {
  const data = await gql(admin, `#graphql
    query SeoShopHosts { shop { myshopifyDomain primaryDomain { host } } }`);
  return [data?.shop?.myshopifyDomain, data?.shop?.primaryDomain?.host].filter(Boolean);
}

type Row = {
  resourceId: string;
  title: string;
  handle: string;
  path: string;
  seoTitle: string;
  seoDescription: string;
  imageCount: number;
  missingAlt: number;
  bodyLength: number;
  extra: Record<string, string>;
  html: string;
  images?: { mediaId: string; url: string; alt: string; position: number; bytes: number; width: number; height: number }[];
};

function toRow(resource: Resource, n: any): Row {
  if (resource === "product") {
    const images = (n.media?.nodes ?? []).filter((m: any) => m?.id && m?.image);
    const text = htmlToText(n.descriptionHtml);
    const price = n.priceRangeV2?.minVariantPrice;
    return {
      resourceId: n.id, title: n.title ?? "", handle: n.handle ?? "", path: `/products/${n.handle}`,
      seoTitle: n.seo?.title ?? "", seoDescription: n.seo?.description ?? "",
      imageCount: images.length, missingAlt: images.filter((m: any) => !String(m.alt ?? "").trim()).length,
      bodyLength: text.length, html: n.descriptionHtml ?? "",
      extra: {
        vendor: n.vendor ?? "", productType: n.productType ?? "",
        price: price ? `${Number(price.amount).toFixed(2)} ${price.currencyCode}` : "",
        excerpt: text.slice(0, 300),
      },
      images: images.map((m: any, i: number) => ({
        mediaId: m.id, url: m.image.url, alt: m.alt ?? "", position: i + 1,
        bytes: m.originalSource?.fileSize ?? 0, width: m.image.width ?? 0, height: m.image.height ?? 0,
      })),
    };
  }
  if (resource === "collection") {
    const text = htmlToText(n.descriptionHtml);
    return {
      resourceId: n.id, title: n.title ?? "", handle: n.handle ?? "", path: `/collections/${n.handle}`,
      seoTitle: n.seo?.title ?? "", seoDescription: n.seo?.description ?? "",
      imageCount: n.image ? 1 : 0, missingAlt: n.image && !String(n.image.altText ?? "").trim() ? 1 : 0,
      bodyLength: text.length, html: n.descriptionHtml ?? "", extra: { excerpt: text.slice(0, 300) },
    };
  }
  const text = htmlToText(n.body);
  const isArticle = resource === "article";
  return {
    resourceId: n.id, title: n.title ?? "", handle: n.handle ?? "",
    path: isArticle ? `/blogs/${n.blog?.handle}/${n.handle}` : `/pages/${n.handle}`,
    seoTitle: n.titleTag?.value ?? "", seoDescription: n.descriptionTag?.value ?? "",
    imageCount: isArticle && n.image ? 1 : 0,
    missingAlt: isArticle && n.image && !String(n.image.altText ?? "").trim() ? 1 : 0,
    bodyLength: text.length, html: n.body ?? "",
    extra: { excerpt: text.slice(0, 300), ...(isArticle ? { blog: n.blog?.title ?? "", blogHandle: n.blog?.handle ?? "" } : {}) },
  };
}

async function saveRows(shop: string, resource: Resource, rows: Row[], hosts: string[]) {
  for (const r of rows) {
    const issues = itemIssues({ resource, ...r });
    await prisma.auditItem.upsert({
      where: { shop_resourceId: { shop, resourceId: r.resourceId } },
      create: {
        shop, resource, resourceId: r.resourceId, title: r.title, handle: r.handle, path: r.path,
        seoTitle: r.seoTitle, seoDescription: r.seoDescription, imageCount: r.imageCount,
        missingAlt: r.missingAlt, bodyLength: r.bodyLength, extra: JSON.stringify(r.extra),
        issues: JSON.stringify(issues), score: scoreFor(issues),
      },
      update: {
        title: r.title, handle: r.handle, path: r.path, seoTitle: r.seoTitle, seoDescription: r.seoDescription,
        imageCount: r.imageCount, missingAlt: r.missingAlt, bodyLength: r.bodyLength,
        extra: JSON.stringify(r.extra), issues: JSON.stringify(issues), score: scoreFor(issues), scannedAt: new Date(),
      },
    });
    if (resource === "product") {
      await prisma.productHandle.upsert({
        where: { shop_productId: { shop, productId: r.resourceId } },
        create: { shop, productId: r.resourceId, handle: r.handle },
        update: { handle: r.handle },
      });
      if (r.images?.length) {
        await prisma.auditImage.createMany({
          data: r.images.map((img) => ({ shop, productId: r.resourceId, productTitle: r.title, ...img })),
          skipDuplicates: true,
        });
      }
    }
    const paths = internalPaths(r.html, hosts);
    if (paths.length) {
      await prisma.linkRef.createMany({
        data: paths.map((path) => ({ shop, sourceId: r.resourceId, sourceTitle: r.title, sourceType: resource, path })),
      });
    }
  }
}

/** Every storefront path a redirect already covers (those links aren't broken). */
async function redirectPaths(admin: AdminClient): Promise<Set<string>> {
  const out = new Set<string>();
  let after: string | null = null;
  for (let i = 0; i < 40; i += 1) {
    const data: any = await gql(admin, `#graphql
      query SeoRedirectPaths($after: String) {
        urlRedirects(first: 250, after: $after) { nodes { path } pageInfo { hasNextPage endCursor } }
      }`, { after });
    for (const n of data?.urlRedirects?.nodes ?? []) out.add(String(n.path).toLowerCase().replace(/\/+$/, ""));
    if (!data?.urlRedirects?.pageInfo?.hasNextPage) break;
    after = data.urlRedirects.pageInfo.endCursor;
  }
  return out;
}

async function finalize(shop: string, admin: AdminClient, scannedAll: boolean) {
  const items = await prisma.auditItem.findMany({ where: { shop } });

  // Duplicates: the effective title (custom or fallback) and custom descriptions.
  const titleCount = new Map<string, number>();
  const descCount = new Map<string, number>();
  for (const it of items) {
    const t = (it.seoTitle || it.title).trim().toLowerCase();
    if (t) titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
    const d = it.seoDescription.trim().toLowerCase();
    if (d) descCount.set(d, (descCount.get(d) ?? 0) + 1);
  }

  // Broken links: only judged when the whole catalogue was scanned — a capped
  // (Free) scan doesn't know every handle, and would cry wolf.
  const brokenSources = new Set<string>();
  if (scannedAll) {
    const known = new Set(items.map((i) => i.path.toLowerCase()));
    for (const it of items) {
      if (it.resource === "article") {
        try {
          const blogHandle = JSON.parse(it.extra).blogHandle;
          if (blogHandle) known.add(`/blogs/${String(blogHandle).toLowerCase()}`);
        } catch { /* ignore */ }
      }
    }
    const redirected = await redirectPaths(admin);
    const refs = await prisma.linkRef.findMany({ where: { shop } });
    const brokenIds: string[] = [];
    for (const ref of refs) {
      if (!known.has(ref.path) && !redirected.has(ref.path)) {
        brokenIds.push(ref.id);
        brokenSources.add(ref.sourceId);
      }
    }
    if (brokenIds.length) await prisma.linkRef.updateMany({ where: { id: { in: brokenIds } }, data: { broken: true } });
  }

  for (const it of items) {
    let issues = JSON.parse(it.issues) as IssueCode[];
    const before = issues.length;
    const t = (it.seoTitle || it.title).trim().toLowerCase();
    if (t && (titleCount.get(t) ?? 0) > 1) issues.push("dup_title");
    const d = it.seoDescription.trim().toLowerCase();
    if (d && (descCount.get(d) ?? 0) > 1) issues.push("dup_desc");
    if (brokenSources.has(it.resourceId)) issues.push("broken_links");
    issues = [...new Set(issues)];
    if (issues.length !== before) {
      await prisma.auditItem.update({ where: { id: it.id }, data: { issues: JSON.stringify(issues), score: scoreFor(issues) } });
    }
  }
}

/** Does one step's worth of scanning and returns the new state. */
export async function runScanStep(shop: string, admin: AdminClient, plan: PlanName): Promise<ScanState> {
  let run = await prisma.auditRun.findUnique({ where: { shop } });
  if (!run || run.status !== "running") return run ? view(run) : (await startScan(shop, plan));

  const started = Date.now();
  let hosts: string[] | null = null;
  try {
    while (Date.now() - started < STEP_BUDGET_MS) {
      const phase = run.phase as (typeof PHASES)[number];
      if (phase === "done") break;
      if (phase === "finalize") {
        await finalize(shop, admin, run.cap < 0 || run.scanned < run.cap);
        run = await prisma.auditRun.update({ where: { shop }, data: { phase: "done", status: "done", finishedAt: new Date() } });
        break;
      }
      // Free plan audits products only; and stops at its item cap.
      const capped = run.cap >= 0 && run.scanned >= run.cap;
      if (capped || (phase !== "product" && !can(plan, "allResources"))) {
        run = await prisma.auditRun.update({ where: { shop }, data: { phase: "finalize", cursor: "" } });
        continue;
      }
      hosts ??= await shopHosts(admin);
      const cap: number = run.cap;
      const done: number = run.scanned;
      const first: number = cap >= 0 ? Math.max(1, Math.min(PAGE, cap - done)) : PAGE;
      const data: any = await gql(admin, QUERIES[phase], { first, after: run.cursor || null });
      const conn: any = data?.[CONNECTION[phase]];
      const rows: Row[] = (conn?.nodes ?? []).map((n: any) => toRow(phase, n));
      await saveRows(shop, phase, rows, hosts);
      const next: string = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : "";
      const nextPhase = next ? phase : PHASES[PHASES.indexOf(phase) + 1];
      run = await prisma.auditRun.update({
        where: { shop },
        data: { scanned: { increment: rows.length }, cursor: next, phase: nextPhase },
      });
    }
  } catch (error: any) {
    console.error("Easy SEO scan:", error);
    run = await prisma.auditRun.update({
      where: { shop },
      data: { status: "failed", error: String(error?.message || error).slice(0, 500) },
    });
  }
  return view(run);
}

/** Recomputes one item's own issues after an edit (keeps dup/broken flags). */
export async function refreshItem(shop: string, resourceId: string, patch: { seoTitle?: string; seoDescription?: string; missingAlt?: number }) {
  const it = await prisma.auditItem.findUnique({ where: { shop_resourceId: { shop, resourceId } } });
  if (!it) return;
  const next = { ...it, ...patch };
  const kept = (JSON.parse(it.issues) as IssueCode[]).filter((c) => c === "broken_links" || c === "dup_title" || c === "dup_desc");
  const issues = [...new Set([...itemIssues({ ...next, resource: it.resource as Resource }), ...kept])];
  await prisma.auditItem.update({
    where: { id: it.id },
    data: { ...patch, issues: JSON.stringify(issues), score: scoreFor(issues) },
  });
}
