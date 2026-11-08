import assert from "node:assert";
import prisma from "../app/db.server";
import { generateAlt } from "../app/models/ai.server";
import { applyAiAltBatch } from "../app/models/meta.server";

process.env.GEMINI_API_KEY = "k";
delete process.env.GEMINI_MODEL;
const png = Buffer.from("89504e470d0a1a0a", "hex");
const seen: { url: string; body?: any }[] = [];
let gemini: number[] = [];
let altText = "Image of a white linen shirt on a wooden hanger";
let imageType = "image/png";
(globalThis as any).fetch = async (url: string, init?: any) => {
  if (url.includes("generativelanguage")) {
    seen.push({ url, body: JSON.parse(init.body) });
    const status = gemini.length ? gemini.shift()! : 200;
    if (status !== 200) return new Response("{}", { status });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ alt: altText }) }] } }] }));
  }
  seen.push({ url });
  if (url.includes("broken")) return new Response("no", { status: 404 });
  return new Response(png, { status: 200, headers: { "content-type": imageType } });
};

// one image: sized CDN URL, inline image sent, "Image of" stripped, capitalised
const alt = await generateAlt({ imageUrl: "https://cdn.shopify.com/s/files/shirt.png?v=1", productTitle: "Linen Shirt", store: "Acme" });
assert.equal(alt, "A white linen shirt on a wooden hanger");
assert.equal(seen[0].url, "https://cdn.shopify.com/s/files/shirt.png?v=1&width=768");
const parts = seen[1].body.contents[0].parts;
assert.equal(parts[0].inlineData.mimeType, "image/png");
assert.equal(parts[0].inlineData.data, png.toString("base64"));
assert.ok(parts[1].text.includes("Product: Linen Shirt"));
altText = "word ".repeat(60);
assert.ok((await generateAlt({ imageUrl: "https://cdn.shopify.com/a.jpg", productTitle: "X", store: "S" })).length <= 125);
await assert.rejects(generateAlt({ imageUrl: "https://cdn.shopify.com/broken.jpg", productTitle: "X", store: "S" }), /Couldn't load/);
imageType = "text/html";
await assert.rejects(generateAlt({ imageUrl: "https://cdn.shopify.com/x.jpg", productTitle: "X", store: "S" }), /format/);
imageType = "image/jpeg";

// bulk over AuditImage rows with no alt
const shop = "ai-alt.myshopify.com";
await prisma.auditImage.deleteMany({ where: { shop } });
await prisma.auditItem.deleteMany({ where: { shop } });
await prisma.auditItem.create({ data: { shop, resource: "product", resourceId: "gid://shopify/Product/1", title: "Shirt", handle: "s", path: "/products/s", seoTitle: "", seoDescription: "", imageCount: 3, missingAlt: 3, bodyLength: 0, extra: "{}", issues: '["alt_missing"]', score: 40 } as any });
for (const [i, url] of ["https://cdn.shopify.com/1.jpg", "https://cdn.shopify.com/broken.jpg", "https://cdn.shopify.com/3.jpg"].entries()) {
  await prisma.auditImage.create({ data: { shop, mediaId: `gid://shopify/MediaImage/${i + 1}`, productId: "gid://shopify/Product/1", productTitle: "Shirt", url, alt: "", position: i + 1 } as any });
}
await prisma.auditImage.create({ data: { shop, mediaId: "gid://shopify/MediaImage/9", productId: "gid://shopify/Product/1", productTitle: "Shirt", url: "https://cdn.shopify.com/9.jpg", alt: "Hand written", position: 4 } as any });
const altWrites: any[] = [];
const admin: any = { graphql: async (q: string, o?: any) => {
  const op = q.match(/(?:query|mutation)\s+(\w+)/)?.[1];
  const ok = (data: any) => new Response(JSON.stringify({ data }));
  if (op === "SeoShopName") return ok({ shop: { name: "Acme" } });
  if (op === "SeoFileUpdate") { altWrites.push(...o.variables.files); return ok({ fileUpdate: { files: [], userErrors: [] } }); }
  throw new Error("unmocked " + op);
} };
altText = "Blue cotton shirt folded on a table";
const r = await applyAiAltBatch({ admin, shop, afterId: "", allowance: 10, paceMs: 0 });
assert.equal(r.applied, 2); assert.equal(r.failed, 1); assert.equal(r.done, true);
assert.equal(altWrites.length, 2);
assert.ok(!altWrites.some((w) => w.id === "gid://shopify/MediaImage/9"), "hand-written alt untouched");
assert.equal((await prisma.auditItem.findFirst({ where: { shop } }))!.missingAlt, 1);
// limit respected
const r2 = await applyAiAltBatch({ admin, shop, afterId: "", allowance: 0, paceMs: 0 });
assert.equal(r2.limited, true);
console.log("ALL AI ALT TESTS PASSED");
process.exit(0);
