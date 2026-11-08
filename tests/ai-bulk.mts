import assert from "node:assert";
import prisma from "../app/db.server";
import { applyAiBatch } from "../app/models/meta.server";

process.env.GEMINI_API_KEY = "k";
const shop = "ai-bulk.myshopify.com";
await prisma.auditItem.deleteMany({ where: { shop } });
const mk = (n: number, seoTitle = "", seoDescription = "") => prisma.auditItem.create({ data: {
  shop, resource: "product", resourceId: `gid://shopify/Product/${n}`, title: `Product ${n}`, handle: `p-${n}`, path: `/products/p-${n}`,
  seoTitle, seoDescription, imageCount: 0, missingAlt: 0, bodyLength: 300, extra: "{}", issues: "[]", score: 50 } as any });
await mk(1); await mk(2, "Hand Title", ""); await mk(3, "Kept", "Kept desc"); await mk(4); await mk(5);

const writes: any[] = [];
const admin: any = { graphql: async (q: string, o?: any) => {
  const op = q.match(/(?:query|mutation)\s+(\w+)/)?.[1];
  const ok = (data: any) => new Response(JSON.stringify({ data }));
  if (op === "SeoShopName") return ok({ shop: { name: "Acme" } });
  if (op === "SeoAiSource") return ok({ node: { __typename: "Product", title: o.variables.id, description: "Nice", vendor: "", productType: "", tags: [], priceRangeV2: null } });
  if (op === "SeoSetMeta") { writes.push(...o.variables.metafields); return ok({ metafieldsSet: { metafields: [], userErrors: [] } }); }
  if (op === "SeoDeleteMeta") return ok({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } });
  throw new Error("unmocked " + op);
} };
let seq: number[] = [];
let n = 0;
(globalThis as any).fetch = async () => {
  const status = seq.length ? seq.shift()! : 200;
  n += 1;
  if (status !== 200) return new Response("{}", { status });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: `AI title ${n}`, description: `AI description ${n} for this item.` }) }] } }] }));
};
const base = { admin, shop, resource: "product" as const, ids: [], paceMs: 0 };

// missing: 4 items need work (#3 complete). Allowance 2 → only 2 this call.
let r = await applyAiBatch({ ...base, scope: "missing", afterId: "", allowance: 2 });
assert.equal(r.applied, 2); assert.equal(r.done, false);
// keep hand-written title on #2
const t2 = writes.find((w) => w.ownerId === "gid://shopify/Product/2" && w.key === "title_tag");
assert.equal(t2.value, "Hand Title");
assert.ok(writes.find((w) => w.ownerId === "gid://shopify/Product/2" && w.key === "description_tag").value.startsWith("AI description"));

// one 429 is retried after a wait; continue from cursor
seq = [429];
const t0 = Date.now();
r = await applyAiBatch({ ...base, scope: "missing", afterId: r.lastId, allowance: 10 });
assert.equal(r.applied, 2); assert.equal(r.done, true); assert.equal(r.stopped, "");
assert.ok(Date.now() - t0 >= 5_000, "waited before retrying the quota error");
assert.equal(await prisma.auditItem.count({ where: { shop, OR: [{ seoTitle: "" }, { seoDescription: "" }] } }), 0);
assert.equal((await prisma.auditItem.findFirst({ where: { shop, resourceId: "gid://shopify/Product/3" } }))!.seoDescription, "Kept desc");

// selected overwrites both; two quota errors in a row stop the run cleanly
const ids = (await prisma.auditItem.findMany({ where: { shop }, orderBy: { id: "asc" } })).map((i) => i.id);
seq = [200, 429, 429];
r = await applyAiBatch({ ...base, scope: "selected", ids: [ids[2], ids[3]], afterId: "", allowance: 10 });
assert.equal(r.applied, 1); assert.equal(r.done, true); assert.match(r.stopped, /quota/);
assert.ok((await prisma.auditItem.findUnique({ where: { id: ids[2] } }))!.seoDescription.startsWith("AI description"));

// zero allowance → limited, no calls
const before = n;
r = await applyAiBatch({ ...base, scope: "missing", afterId: "", allowance: 0 });
assert.equal(r.limited, true); assert.equal(n, before);
console.log("ALL AI BULK TESTS PASSED");
process.exit(0);
