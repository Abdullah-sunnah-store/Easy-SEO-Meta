import assert from "node:assert";
import http from "node:http";
import sharp from "sharp";
import prisma from "../app/db.server";
import { startScan, runScanStep } from "../app/models/scan.server";
import { applyTemplateBatch, applyAltBatch, saveItemSeo } from "../app/models/meta.server";
import { compressBatch, restoreImage } from "../app/models/images.server";
import { buildLlmsTxt } from "../app/models/llms.server";
import { parseRedirectCsv } from "../app/lib/csv";
import { normalisePath } from "../app/lib/links";
import { renderTemplate } from "../app/lib/templates";
import { parseIssues } from "../app/lib/audit";

const shop = "seo-test.myshopify.com";
// ---- tiny image server + staged upload sink
const bigJpeg = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: { r: 30, g: 90, b: 160 } } })
  .composite([{ input: Buffer.from(`<svg width="3600" height="2400"><circle cx="1800" cy="1200" r="900" fill="orange"/><text x="300" y="400" font-size="200">noise ${"x".repeat(40)}</text></svg>`) }])
  .jpeg({ quality: 100 }).toBuffer();
const uploads: number[] = [];
const server = http.createServer((req, res) => {
  if (req.method === "GET") { res.writeHead(200, { "content-type": "image/jpeg" }); res.end(bigJpeg); return; }
  let size = 0; req.on("data", (c) => (size += c.length)); req.on("end", () => { uploads.push(size); res.writeHead(201); res.end(); });
});
await new Promise<void>((r) => server.listen(8822, r));
const IMG = "http://localhost:8822/products/shirt.jpg";

const products = Array.from({ length: 55 }, (_, i) => ({
  id: `gid://shopify/Product/${i + 1}`, title: i === 1 ? "Blue Shirt" : `Product ${i + 1}`, handle: `product-${i + 1}`, vendor: "Acme", productType: "Shirts",
  descriptionHtml: i === 0 ? `<p>${"Great shirt. ".repeat(30)}</p><a href="/products/product-2">ok</a> <a href="https://seo-test.myshopify.com/fr/products/deleted-thing?x=1">dead</a> <a href="/collections/sale/products/product-3">ok2</a> <a href="/pages/old-page">redirected</a>` : "<p>Short</p>",
  seo: { title: i === 2 ? "Same Title" : i === 3 ? "Same Title" : "", description: i === 4 ? "x".repeat(200) : "" },
  priceRangeV2: { minVariantPrice: { amount: "19.5", currencyCode: "USD" } },
  media: { nodes: i < 2 ? [{ id: `gid://shopify/MediaImage/${i + 1}`, alt: i === 0 ? "" : "has alt", image: { url: IMG, width: 3600, height: 2400 }, originalSource: { fileSize: bigJpeg.length } }] : [] },
}));
const mutations: Record<string, any[]> = {};
const page = (arr: any[], first: number, after: string | null) => {
  const start = after ? Number(after) : 0;
  const nodes = arr.slice(start, start + first);
  return { nodes, pageInfo: { hasNextPage: start + first < arr.length, endCursor: String(start + first) } };
};
const admin: any = { graphql: async (q: string, o?: any) => {
  const v = o?.variables ?? {};
  const op = q.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "";
  const ok = (data: any) => new Response(JSON.stringify({ data }));
  (mutations[op] ??= []).push(v);
  switch (op) {
    case "SeoShopHosts": return ok({ shop: { myshopifyDomain: "seo-test.myshopify.com", primaryDomain: { host: "acme.com" } } });
    case "SeoShopName": return ok({ shop: { name: "Acme" } });
    case "SeoScanProducts": return ok({ products: page(products, v.first, v.after) });
    case "SeoScanCollections": return ok({ collections: page([{ id: "gid://shopify/Collection/1", title: "Sale", handle: "sale", descriptionHtml: "", seo: { title: "", description: "" }, image: null }], v.first, v.after) });
    case "SeoScanPages": return ok({ pages: page([{ id: "gid://shopify/Page/1", title: "About", handle: "about", body: "<p>About us</p>", titleTag: { value: "About Acme" }, descriptionTag: null }], v.first, v.after) });
    case "SeoScanArticles": return ok({ articles: page([{ id: "gid://shopify/Article/1", title: "Linen care", handle: "linen-care", body: `<a href="/blogs/journal">blog</a><a href="/blogs/journal/missing-post">x</a>`, blog: { title: "Journal", handle: "journal" }, image: null, titleTag: null, descriptionTag: null }], v.first, v.after) });
    case "SeoRedirectPaths": return ok({ urlRedirects: { nodes: [{ path: "/pages/old-page" }], pageInfo: { hasNextPage: false } } });
    case "SeoSetMeta": return ok({ metafieldsSet: { metafields: [], userErrors: [] } });
    case "SeoDeleteMeta": return ok({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } });
    case "SeoFileUpdate": case "SeoReplace": return ok({ fileUpdate: { files: [], userErrors: [] } });
    case "SeoStaged": return ok({ stagedUploadsCreate: { stagedTargets: [{ url: "http://localhost:8822/upload", resourceUrl: `https://staged/${mutations.SeoStaged.length}`, parameters: [{ name: "key", value: "k" }] }], userErrors: [] } });
    case "SeoBackup": return ok({ fileCreate: { files: [{ id: "gid://shopify/MediaImage/999" }], userErrors: [] } });
    case "SeoBackupUrl": return ok({ node: { fileStatus: "READY", image: { url: "https://cdn/backup.jpg" } } });
    case "SeoLlms": return ok({ shop: { name: "Acme", description: "Organic basics", primaryDomain: { url: "https://acme.com" } }, collections: { nodes: [{ title: "Sale", handle: "sale", description: "Deals" }] }, products: { nodes: [{ title: "Blue Shirt", handle: "blue-shirt", description: "Soft", status: "ACTIVE" }] }, pages: { nodes: [{ title: "About", handle: "about", isPublished: true }] }, blogs: { nodes: [{ title: "Journal", handle: "journal" }] } });
    default: throw new Error("unmocked op " + op);
  }
} };

// ---- pure helpers
assert.equal(renderTemplate("{{title}} | {{shop}}", { title: "Shirt", shop: "" }, 60), "Shirt");
assert.equal(renderTemplate("{{title}} | {{vendor}} | {{shop}}", { title: "Shirt", vendor: "", shop: "Acme" }, 60), "Shirt | Acme");
assert.ok(renderTemplate("{{excerpt}}", { excerpt: "word ".repeat(80) }, 160).length <= 160);
assert.equal(normalisePath("https://acme.com/en-us/products/x?y=1#z", ["acme.com"]), "/products/x");
assert.equal(normalisePath("https://other.com/products/x", ["acme.com"]), null);
assert.equal(normalisePath("/collections/all", []), null);
assert.equal(parseRedirectCsv("Redirect from,Redirect to\n/a,/b\nbad,/c\n/d,").filter((r) => !r.error).length, 1);

// ---- Free plan scan: products only, capped at 100 → 55 products, no broken-link verdicts? (all products scanned < cap so scannedAll=true)
for (const m of ["shopSettings","auditRun","auditItem","auditImage","linkRef","productHandle","usage","compressedImage","redirectLog"]) await (prisma as any)[m].deleteMany({ where: { shop } });
let s = await startScan(shop, "Free");
for (let i = 0; i < 20 && s.status === "running"; i++) s = await runScanStep(shop, admin, "Free");
assert.equal(s.status, "done"); assert.equal(s.scanned, 55);
assert.equal(await prisma.auditItem.count({ where: { shop, resource: { not: "product" } } }), 0, "free = products only");

// ---- Advanced scan: everything + finalize
s = await startScan(shop, "Advanced");
for (let i = 0; i < 20 && s.status === "running"; i++) s = await runScanStep(shop, admin, "Advanced");
assert.equal(s.status, "done"); assert.equal(s.scanned, 58);
const p1 = await prisma.auditItem.findUnique({ where: { shop_resourceId: { shop, resourceId: "gid://shopify/Product/1" } } });
const i1 = parseIssues(p1!.issues);
assert.ok(i1.includes("alt_missing") && i1.includes("broken_links") && !i1.includes("thin_content"), JSON.stringify(i1));
const p3 = parseIssues((await prisma.auditItem.findUnique({ where: { shop_resourceId: { shop, resourceId: "gid://shopify/Product/3" } } }))!.issues);
assert.ok(p3.includes("dup_title"));
assert.ok(parseIssues((await prisma.auditItem.findUnique({ where: { shop_resourceId: { shop, resourceId: "gid://shopify/Product/5" } } }))!.issues).includes("desc_long"));
const broken = (await prisma.linkRef.findMany({ where: { shop, broken: true } })).map((b) => b.path).sort();
assert.deepEqual(broken, ["/blogs/journal/missing-post", "/products/deleted-thing"], JSON.stringify(broken));
assert.equal(await prisma.auditImage.count({ where: { shop } }), 2);
assert.equal(await prisma.productHandle.count({ where: { shop } }), 55);

// ---- bulk template: missing only, capped by allowance 20 then rest
await prisma.shopSettings.upsert({ where: { shop }, create: { shop, templates: JSON.stringify({ product: { title: "{{title}} | {{shop}}", description: "Buy {{title}} from {{vendor}} — {{price}}" } }) }, update: { templates: JSON.stringify({ product: { title: "{{title}} | {{shop}}", description: "Buy {{title}} from {{vendor}} — {{price}}" } }) } });
let r = await applyTemplateBatch({ admin, shop, resource: "product", scope: "missing", ids: [], afterId: "", allowance: 20, batch: 12 });
assert.equal(r.applied, 12); assert.equal(r.done, false);
const set = mutations.SeoSetMeta.flatMap((x) => x.metafields);
const shirt = set.find((m: any) => m.ownerId === "gid://shopify/Product/2" && m.key === "title_tag");
assert.equal(shirt.value, "Blue Shirt | Acme");
const desc5 = set.find((m: any) => m.ownerId === "gid://shopify/Product/5" && m.key === "description_tag");
assert.equal(desc5.value, "x".repeat(200), "missing-scope keeps hand-written description");
let total = r.applied; let last = r.lastId;
while (!r.done) { r = await applyTemplateBatch({ admin, shop, resource: "product", scope: "missing", ids: [], afterId: last, allowance: 100, batch: 12 }); total += r.applied; last = r.lastId; }
assert.equal(total, 55);
assert.equal(await prisma.auditItem.count({ where: { shop, resource: "product", seoTitle: "" } }), 0);
// manual save with empty description deletes the metafield
await saveItemSeo(admin, shop, { resourceId: "gid://shopify/Product/9", title: "Custom", description: "" });
assert.ok(mutations.SeoDeleteMeta.at(-1).metafields.some((m: any) => m.ownerId === "gid://shopify/Product/9" && m.key === "description_tag"));

// ---- alt
const alt = await applyAltBatch({ admin, shop, scope: "missing", afterId: "", allowance: 50 });
assert.equal(alt.applied, 1); assert.equal(mutations.SeoFileUpdate.at(-1).files[0].alt, "Product 1");
assert.ok(!parseIssues((await prisma.auditItem.findUnique({ where: { shop_resourceId: { shop, resourceId: "gid://shopify/Product/1" } } }))!.issues).includes("alt_missing"));

// ---- compression: 2 images, backup + replace, then restore
const c = await compressBatch(admin, shop, 10);
assert.equal(c.compressed, 2, JSON.stringify(c)); assert.equal(c.done, true);
assert.equal(uploads.length, 4, "backup + compressed upload per image");
assert.ok(uploads[1] < uploads[0] / 3, `compressed ${uploads[1]} vs original ${uploads[0]}`);
assert.equal(mutations.SeoReplace.length, 2);
const rec = await prisma.compressedImage.findFirst({ where: { shop, status: "compressed" } });
assert.ok(rec!.newBytes < rec!.originalBytes && rec!.backupFileId);
await restoreImage(admin, shop, rec!.mediaId);
assert.equal(mutations.SeoReplace.at(-1).files[0].originalSource, "https://cdn/backup.jpg");
assert.equal((await prisma.compressedImage.findUnique({ where: { id: rec!.id } }))!.status, "restored");
const again = await compressBatch(admin, shop, 10);
assert.equal(again.compressed, 0, "restored images aren't recompressed");

// ---- llms
const llms = await buildLlmsTxt(admin, "");
assert.ok(llms.startsWith("# Acme\n\n> Organic basics") && llms.includes("- [Blue Shirt](https://acme.com/products/blue-shirt): Soft") && llms.includes("## Policies"));

server.close();
console.log("ALL SEO TESTS PASSED");
process.exit(0);
