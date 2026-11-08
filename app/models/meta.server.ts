// Writing SEO fields and image alt text.
//
// SEO title/description live in the global.title_tag / global.description_tag
// metafields for every resource type — products and collections expose them
// as `seo` too, but writing the metafields is one code path for all four.

import prisma from "../db.server";
import { gql, userErrorText, type AdminClient, AdminError } from "./admin.server";
import { refreshItem } from "./scan.server";
import { AiError, generateMeta, loadSource } from "./ai.server";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  parseTemplates,
  renderTemplate,
  type Resource,
} from "../lib/templates";

const SET = `#graphql
  mutation SeoSetMeta($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }`;
const DELETE = `#graphql
  mutation SeoDeleteMeta($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
  }`;
const FILE_UPDATE = `#graphql
  mutation SeoFileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) { files { id alt } userErrors { field message } }
  }`;

export type SeoEdit = { resourceId: string; title: string; description: string };

/** Writes SEO fields; an empty value removes the custom one (Shopify falls back). */
export async function writeSeo(admin: AdminClient, edits: SeoEdit[]): Promise<void> {
  const sets: any[] = [];
  const deletes: any[] = [];
  for (const e of edits) {
    const title = e.title.trim().slice(0, 255);
    const desc = e.description.trim().slice(0, 1000);
    if (title) sets.push({ ownerId: e.resourceId, namespace: "global", key: "title_tag", type: "single_line_text_field", value: title });
    else deletes.push({ ownerId: e.resourceId, namespace: "global", key: "title_tag" });
    if (desc) sets.push({ ownerId: e.resourceId, namespace: "global", key: "description_tag", type: "multi_line_text_field", value: desc });
    else deletes.push({ ownerId: e.resourceId, namespace: "global", key: "description_tag" });
  }
  for (let i = 0; i < sets.length; i += 25) {
    const data = await gql(admin, SET, { metafields: sets.slice(i, i + 25) });
    const err = userErrorText(data?.metafieldsSet?.userErrors);
    if (err) throw new AdminError(err);
  }
  for (let i = 0; i < deletes.length; i += 25) {
    const data = await gql(admin, DELETE, { metafields: deletes.slice(i, i + 25) });
    const err = userErrorText(data?.metafieldsDelete?.userErrors);
    if (err) throw new AdminError(err);
  }
}

export async function writeAlt(admin: AdminClient, edits: { mediaId: string; alt: string }[]): Promise<void> {
  for (let i = 0; i < edits.length; i += 25) {
    const batch = edits.slice(i, i + 25).map((e) => ({ id: e.mediaId, alt: e.alt.trim().slice(0, 512) }));
    const data = await gql(admin, FILE_UPDATE, { files: batch });
    const err = userErrorText(data?.fileUpdate?.userErrors);
    if (err) throw new AdminError(err);
  }
}

/** Saves one item's SEO fields and refreshes its audit row. */
export async function saveItemSeo(admin: AdminClient, shop: string, edit: SeoEdit) {
  await writeSeo(admin, [edit]);
  await refreshItem(shop, edit.resourceId, { seoTitle: edit.title.trim(), seoDescription: edit.description.trim() });
}

let shopNameCache = new Map<string, string>();
export async function shopName(admin: AdminClient, shop: string): Promise<string> {
  const hit = shopNameCache.get(shop);
  if (hit) return hit;
  const data = await gql(admin, `#graphql
    query SeoShopName { shop { name } }`);
  const name = data?.shop?.name ?? "";
  if (shopNameCache.size > 2000) shopNameCache = new Map();
  shopNameCache.set(shop, name);
  return name;
}

export function templateContext(item: { title: string; extra: string }, shop: string): Record<string, string> {
  let extra: any = {};
  try {
    extra = JSON.parse(item.extra || "{}");
  } catch {
    extra = {};
  }
  return {
    title: item.title,
    shop,
    vendor: extra.vendor ?? "",
    product_type: extra.productType ?? "",
    price: extra.price ?? "",
    excerpt: extra.excerpt ?? "",
    blog: extra.blog ?? "",
  };
}

/** What a template would produce for an item (previews and bulk apply). */
export function renderFor(
  resource: Resource,
  templatesJson: string,
  item: { title: string; extra: string },
  shop: string,
) {
  const t = parseTemplates(templatesJson)[resource];
  const ctx = templateContext(item, shop);
  return {
    title: renderTemplate(t.title, ctx, TITLE_MAX),
    description: renderTemplate(t.description, ctx, DESCRIPTION_MAX),
  };
}

export type BulkScope = "missing" | "all" | "selected";

/**
 * Applies the resource's template to the next `batch` items in scope that
 * haven't been done in this run (`afterId` is the last id handled), capped by
 * `allowance` (plan usage). The browser calls repeatedly until `done`.
 */
export async function applyTemplateBatch(args: {
  admin: AdminClient;
  shop: string;
  resource: Resource;
  scope: BulkScope;
  ids: string[];
  afterId: string;
  allowance: number;
  batch?: number;
}) {
  const { admin, shop, resource, scope } = args;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const name = await shopName(admin, shop);
  const where: any = { shop, resource };
  if (scope === "selected") where.id = { in: args.ids.slice(0, 500) };
  if (scope === "missing") where.OR = [{ seoTitle: "" }, { seoDescription: "" }];
  if (args.afterId) where.id = { ...(where.id ?? {}), gt: args.afterId };
  const take = Math.max(0, Math.min(args.batch ?? 12, args.allowance));
  if (take === 0) return { done: true, applied: 0, lastId: args.afterId, limited: true };

  const items = await prisma.auditItem.findMany({ where, orderBy: { id: "asc" }, take });
  if (!items.length) return { done: true, applied: 0, lastId: args.afterId, limited: false };

  const edits = items.map((it) => {
    const r = renderFor(resource, settings?.templates ?? "{}", it, name);
    // "missing" fills only the empty field and keeps whatever was written by hand.
    return {
      resourceId: it.resourceId,
      title: scope === "missing" && it.seoTitle ? it.seoTitle : r.title,
      description: scope === "missing" && it.seoDescription ? it.seoDescription : r.description,
    };
  });
  await writeSeo(admin, edits);
  for (const e of edits) {
    await refreshItem(shop, e.resourceId, { seoTitle: e.title, seoDescription: e.description });
  }
  const more = await prisma.auditItem.count({ where: { ...where, id: { ...(where.id ?? {}), gt: items[items.length - 1].id } } });
  return { done: more === 0, applied: items.length, lastId: items[items.length - 1].id, limited: false };
}

/** Alt text for images without one, from the alt template. */
export async function applyAltBatch(args: {
  admin: AdminClient;
  shop: string;
  scope: "missing" | "all";
  afterId: string;
  allowance: number;
  batch?: number;
}) {
  const { admin, shop } = args;
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const template = parseTemplates(settings?.templates).alt;
  const name = await shopName(admin, shop);
  const take = Math.max(0, Math.min(args.batch ?? 25, args.allowance));
  if (take === 0) return { done: true, applied: 0, lastId: args.afterId, limited: true };
  const where: any = { shop, ...(args.scope === "missing" ? { alt: "" } : {}) };
  if (args.afterId) where.id = { gt: args.afterId };
  const images = await prisma.auditImage.findMany({ where, orderBy: { id: "asc" }, take });
  if (!images.length) return { done: true, applied: 0, lastId: args.afterId, limited: false };

  const products = await prisma.auditItem.findMany({
    where: { shop, resourceId: { in: [...new Set(images.map((i) => i.productId))] } },
    select: { resourceId: true, extra: true },
  });
  const vendorOf = new Map(products.map((p) => [p.resourceId, (() => { try { return JSON.parse(p.extra).vendor ?? ""; } catch { return ""; } })()]));
  const edits = images.map((img) => ({
    mediaId: img.mediaId,
    alt: renderTemplate(template, { product_title: img.productTitle, shop: name, vendor: vendorOf.get(img.productId), n: img.position > 1 ? img.position : "" }, 125),
  }));
  await writeAlt(admin, edits);
  for (const e of edits) await prisma.auditImage.updateMany({ where: { shop, mediaId: e.mediaId }, data: { alt: e.alt } });
  // Refresh missing-alt counts on the affected products.
  for (const productId of new Set(images.map((i) => i.productId))) {
    const missing = await prisma.auditImage.count({ where: { shop, productId, alt: "" } });
    await refreshItem(shop, productId, { missingAlt: missing });
  }
  const more = await prisma.auditImage.count({ where: { ...where, id: { gt: images[images.length - 1].id } } });
  return { done: more === 0, applied: images.length, lastId: images[images.length - 1].id, limited: false };
}

/**
 * AI-written title + description for many items, one Gemini call per item.
 *
 * "missing" fills only empty fields (hand-written text is kept); "selected"
 * rewrites both fields of the chosen items. Runs for at most ~20 s per call and
 * reports a cursor, so the screen keeps calling until done — the same loop as
 * the template bulk apply. Calls are paced because Gemini's free tier limits
 * requests per minute; a quota hit waits once, then stops the run cleanly with
 * everything written so far kept.
 */
export async function applyAiBatch(args: {
  admin: AdminClient;
  shop: string;
  resource: Resource;
  scope: "missing" | "selected";
  ids: string[];
  afterId: string;
  allowance: number;
  budgetMs?: number;
  paceMs?: number;
}) {
  const { admin, shop, resource, scope } = args;
  const started = Date.now();
  const budget = args.budgetMs ?? 20_000;
  const pace = args.paceMs ?? 1_200;
  const where: any = { shop, resource };
  if (scope === "selected") where.id = { in: args.ids.slice(0, 500) };
  if (scope === "missing") where.OR = [{ seoTitle: "" }, { seoDescription: "" }];
  if (args.afterId) where.id = { ...(where.id ?? {}), gt: args.afterId };
  const take = Math.max(0, Math.min(10, args.allowance));
  if (take === 0) return { done: true, applied: 0, failed: 0, lastId: args.afterId, limited: true, stopped: "" };

  const items = await prisma.auditItem.findMany({ where, orderBy: { id: "asc" }, take });
  if (!items.length) return { done: true, applied: 0, failed: 0, lastId: args.afterId, limited: false, stopped: "" };

  const store = await shopName(admin, shop);
  let applied = 0;
  let failed = 0;
  let lastId = args.afterId;
  let stopped = "";

  for (const [i, it] of items.entries()) {
    if (i > 0 && Date.now() - started > budget) break;
    if (i > 0) await new Promise((r) => setTimeout(r, pace));
    let written: { title: string; description: string } | null = null;
    for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
      try {
        written = await generateMeta(await loadSource(admin, it.resourceId), store);
      } catch (error) {
        if (error instanceof AiError && error.code === "quota" && attempt === 0) {
          await new Promise((r) => setTimeout(r, 6_000));
          continue;
        }
        if (error instanceof AiError && error.code === "quota") stopped = error.message;
        else if (error instanceof AiError && /isn't set up|key isn't valid|refused|No AI model/.test(error.message)) stopped = error.message;
        else console.warn(`Easy SEO AI bulk: skipped ${it.resourceId}:`, (error as Error)?.message || error);
        break;
      }
    }
    if (stopped) break;
    lastId = it.id;
    if (!written) {
      failed += 1;
      continue;
    }
    const edit = {
      resourceId: it.resourceId,
      title: scope === "missing" && it.seoTitle ? it.seoTitle : written.title,
      description: scope === "missing" && it.seoDescription ? it.seoDescription : written.description,
    };
    await writeSeo(admin, [edit]);
    await refreshItem(shop, edit.resourceId, { seoTitle: edit.title, seoDescription: edit.description });
    applied += 1;
  }

  const more = stopped
    ? 0
    : await prisma.auditItem.count({ where: { ...where, id: { ...(where.id ?? {}), gt: lastId } } });
  return { done: more === 0, applied, failed, lastId, limited: false, stopped };
}
