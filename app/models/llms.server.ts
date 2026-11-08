// llms.txt — a plain-text map of the store for AI search tools (llmstxt.org).
//
// Generated from the store's own data and cached on ShopSettings; the app
// proxy serves it at /apps/easy-seo/llms.txt and a URL redirect sends
// /llms.txt there.

import prisma from "../db.server";
import { gql, type AdminClient } from "./admin.server";
import { createRedirect, deleteRedirect } from "./redirects.server";

import { LLMS_PROXY_PATH } from "../lib/llms";
export { LLMS_PROXY_PATH };

const clean = (s: string) => String(s || "").replace(/\s+/g, " ").trim();

export async function buildLlmsTxt(admin: AdminClient, intro: string): Promise<string> {
  const data = await gql(admin, `#graphql
    query SeoLlms {
      shop { name description primaryDomain { url } }
      collections(first: 30, sortKey: TITLE) { nodes { title handle description(truncateAt: 160) } }
      products(first: 60, sortKey: UPDATED_AT, reverse: true, query: "status:active") { nodes { title handle description(truncateAt: 140) status } }
      pages(first: 30) { nodes { title handle isPublished } }
      blogs(first: 10) { nodes { title handle } }
    }`);
  const shop = data?.shop ?? {};
  const base = String(shop?.primaryDomain?.url ?? "").replace(/\/+$/, "");
  const lines: string[] = [];
  lines.push(`# ${clean(shop.name)}`, "");
  const summary = clean(intro) || clean(shop.description);
  if (summary) lines.push(`> ${summary}`, "");
  const section = (title: string, rows: string[]) => {
    if (!rows.length) return;
    lines.push(`## ${title}`, "", ...rows, "");
  };
  section(
    "Collections",
    (data?.collections?.nodes ?? []).map((c: any) => `- [${clean(c.title)}](${base}/collections/${c.handle})${c.description ? `: ${clean(c.description)}` : ""}`),
  );
  section(
    "Products",
    (data?.products?.nodes ?? [])
      .filter((p: any) => p.status === "ACTIVE")
      .map((p: any) => `- [${clean(p.title)}](${base}/products/${p.handle})${p.description ? `: ${clean(p.description)}` : ""}`),
  );
  section(
    "Pages",
    (data?.pages?.nodes ?? []).filter((p: any) => p.isPublished).map((p: any) => `- [${clean(p.title)}](${base}/pages/${p.handle})`),
  );
  section("Blogs", (data?.blogs?.nodes ?? []).map((b: any) => `- [${clean(b.title)}](${base}/blogs/${b.handle})`));
  section("Policies", [
    `- [Shipping policy](${base}/policies/shipping-policy)`,
    `- [Refund policy](${base}/policies/refund-policy)`,
    `- [Privacy policy](${base}/policies/privacy-policy)`,
    `- [Terms of service](${base}/policies/terms-of-service)`,
  ]);
  return lines.join("\n").trim() + "\n";
}

/** Regenerates and stores the file. */
export async function regenerateLlms(admin: AdminClient, shop: string) {
  const settings = await prisma.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} });
  const text = await buildLlmsTxt(admin, settings.llmsIntro);
  await prisma.shopSettings.update({ where: { shop }, data: { llmsText: text, llmsGeneratedAt: new Date() } });
  return text;
}

/** Turns /llms.txt on or off (the redirect is what makes it reachable). */
export async function setLlmsEnabled(admin: AdminClient, shop: string, enabled: boolean) {
  const settings = await prisma.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} });
  let redirectId = settings.llmsRedirectId;
  if (enabled && !redirectId) {
    redirectId = (await createRedirect(admin, shop, "/llms.txt", LLMS_PROXY_PATH, "llms", true)) ?? "";
  }
  if (!enabled && redirectId) {
    await deleteRedirect(admin, redirectId).catch(() => undefined);
    redirectId = "";
  }
  await prisma.shopSettings.update({ where: { shop }, data: { llmsEnabled: enabled, llmsRedirectId: redirectId } });
  if (enabled && !settings.llmsText) await regenerateLlms(admin, shop);
}
