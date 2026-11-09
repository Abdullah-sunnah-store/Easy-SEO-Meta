import assert from "node:assert";
import prisma from "../app/db.server";
import { autoFillNewProduct } from "../app/models/newProduct.server";

const shop = "new-product.myshopify.com";
await prisma.usage.deleteMany({ where: { shop } });
const templates = JSON.stringify({ product: { title: "{{title}} | {{shop}}", description: "Buy {{title}} from {{vendor}}" } });
const payload = { title: "Linen Shirt", body_html: "<p>Breathable linen.</p>", vendor: "Acme", product_type: "Shirts", tags: "summer, linen", variants: [{ price: "19.50" }],
  media: [{ admin_graphql_api_id: "gid://shopify/MediaImage/1", alt: "" }, { admin_graphql_api_id: "gid://shopify/MediaImage/2", alt: "Already set" }] };

let currentSeo: any = { title: null, description: null };
const sets: any[] = []; const deletes: any[] = []; const alts: any[] = [];
const admin: any = { graphql: async (q: string, o?: any) => {
  const op = q.match(/(?:query|mutation)\s+(\w+)/)?.[1];
  const ok = (data: any) => new Response(JSON.stringify({ data }));
  if (op === "SeoShopName") return ok({ shop: { name: "Acme Store" } });
  if (op === "SeoCurrentProductSeo") return ok({ product: { seo: currentSeo } });
  if (op === "SeoSetMeta") { sets.push(...o.variables.metafields); return ok({ metafieldsSet: { metafields: [], userErrors: [] } }); }
  if (op === "SeoDeleteMeta") { deletes.push(...o.variables.metafields); return ok({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } }); }
  if (op === "SeoFileUpdate") { alts.push(...o.variables.files); return ok({ fileUpdate: { files: [], userErrors: [] } }); }
  throw new Error("unmocked " + op);
} };
let geminiDelay = 0; let geminiCalls = 0;
(globalThis as any).fetch = async () => {
  geminiCalls += 1;
  await new Promise((r) => setTimeout(r, geminiDelay));
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "AI Linen Shirt", description: "AI description for a breathable linen shirt, ready for summer days." }) }] } }] }));
};
const val = (id: string, key: string) => sets.filter((m) => m.ownerId === id && m.key === key).at(-1)?.value;
const base = { admin, shop, plan: "Basic" as const, payload };

// templates only (AI off) + alt for the image without one
let r = await autoFillNewProduct({ ...base, settings: { templates, autoMetaAi: false }, productId: "gid://shopify/Product/1" });
assert.equal(r.wrote, "template"); assert.equal(geminiCalls, 0);
assert.equal(val("gid://shopify/Product/1", "title_tag"), "Linen Shirt | Acme Store");
assert.equal(alts.length, 1); assert.equal(alts[0].id, "gid://shopify/MediaImage/1");

// merchant typed a title → kept; only the description is filled
delete process.env.GEMINI_API_KEY;
currentSeo = { title: "My Own Title", description: "" };
r = await autoFillNewProduct({ ...base, settings: { templates, autoMetaAi: true }, productId: "gid://shopify/Product/2" });
assert.equal(val("gid://shopify/Product/2", "title_tag"), "My Own Title");
assert.equal(val("gid://shopify/Product/2", "description_tag"), "Buy Linen Shirt from Acme");
assert.equal(r.wrote, "template", "no key → template");

// both typed → nothing written
currentSeo = { title: "T", description: "D" };
const before = sets.length + deletes.length;
r = await autoFillNewProduct({ ...base, settings: { templates, autoMetaAi: true }, productId: "gid://shopify/Product/3" });
assert.equal(r.wrote, "none"); assert.equal(sets.length + deletes.length, before);

// AI on → AI text, usage counted
process.env.GEMINI_API_KEY = "k";
currentSeo = { title: null, description: null };
r = await autoFillNewProduct({ ...base, settings: { templates, autoMetaAi: true }, productId: "gid://shopify/Product/4" });
assert.equal(r.wrote, "ai");
assert.equal(val("gid://shopify/Product/4", "title_tag"), "AI Linen Shirt");
assert.equal((await prisma.usage.findFirst({ where: { shop } }))!.aiGenerations, 1);

// AI slower than the deadline → template, not counted
geminiDelay = 400;
r = await autoFillNewProduct({ ...base, settings: { templates, autoMetaAi: true }, productId: "gid://shopify/Product/5", deadlineMs: 100 });
assert.equal(r.wrote, "template");
assert.equal(val("gid://shopify/Product/5", "title_tag"), "Linen Shirt | Acme Store");
assert.equal((await prisma.usage.findFirst({ where: { shop } }))!.aiGenerations, 1);

// Free plan has 10 AI writes; when used up → template
geminiDelay = 0;
await prisma.usage.updateMany({ where: { shop }, data: { aiGenerations: 10 } });
r = await autoFillNewProduct({ ...base, plan: "Free", settings: { templates, autoMetaAi: true }, productId: "gid://shopify/Product/6" });
assert.equal(r.wrote, "template");
console.log("ALL NEW PRODUCT TESTS PASSED");
process.exit(0);
