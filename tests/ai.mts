import assert from "node:assert";
import { generateMeta, loadSource, AiError } from "../app/models/ai.server";

const calls: { url: string; body: any; key: string | null }[] = [];
let plan: Array<{ status: number; body?: any }> = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] });
  const next = plan.shift() ?? { status: 500 };
  return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {}), { status: next.status });
};
const answer = (o: any) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] } });
const src = { kind: "product" as const, title: "Linen Shirt", text: "Breathable linen shirt for summer.", vendor: "Acme", price: "19.50 USD" };

// no key → clear error, no network
delete process.env.GEMINI_API_KEY;
await assert.rejects(generateMeta(src, "Acme"), (e: any) => e instanceof AiError && /isn't set up/.test(e.message));
assert.equal(calls.length, 0);

process.env.GEMINI_API_KEY = "  test-key\n";
// first model retired (404) → falls back to the next; key trimmed; long text truncated
plan = [{ status: 404 }, answer({ title: '"Linen Shirt – Breathable Summer Shirt by Acme for Men and Women Everywhere"', description: "word ".repeat(60) })];
const out = await generateMeta(src, "Acme");
assert.equal(calls.length, 2);
assert.ok(calls[0].url.includes("gemini-3.5-flash-lite") && calls[1].url.includes("gemini-3.1-flash-lite"));
assert.equal(calls[1].key, "test-key");
assert.ok(out.title.length <= 60 && !out.title.startsWith('"'), out.title);
assert.ok(out.description.length <= 160);
assert.ok(calls[1].body.contents[0].parts[0].text.includes("Brand: Acme"));
// working model is remembered
plan = [answer({ title: "Linen Shirt", description: "A breathable linen shirt for warm days. Shop now." })];
await generateMeta(src, "Acme");
assert.ok(calls.at(-1)!.url.includes("gemini-3.1-flash-lite"));
// quota / bad key / garbage
plan = [{ status: 429 }];
await assert.rejects(generateMeta(src, "Acme"), /quota/);
plan = [{ status: 400, body: "API key not valid. Please pass a valid API key." }];
await assert.rejects(generateMeta(src, "Acme"), /key isn't valid/);
plan = [{ status: 200, body: { candidates: [{ content: { parts: [{ text: "not json" }] } }] } }];
await assert.rejects(generateMeta(src, "Acme"), /unreadable/);
// pinned model
process.env.GEMINI_MODEL = "my-model";
plan = [answer({ title: "T", description: "D" })];
await generateMeta(src, "Acme");
assert.ok(calls.at(-1)!.url.includes("/my-model:generateContent"));

// loadSource maps each type
const admin = (node: any) => ({ graphql: async () => new Response(JSON.stringify({ data: { node } })) });
const p = await loadSource(admin({ __typename: "Product", title: "A", description: "d", vendor: "V", productType: "T", tags: ["x"], priceRangeV2: { minVariantPrice: { amount: "5", currencyCode: "USD" } } }), "gid://shopify/Product/1");
assert.equal(p.price, "5.00 USD");
const a = await loadSource(admin({ __typename: "Article", title: "Post", body: "<p>Hello <b>world</b></p>", blog: { title: "News" } }), "gid://shopify/Article/1");
assert.equal(a.text.trim(), "Hello world"); assert.equal(a.blog, "News");
await assert.rejects(loadSource(admin(null), "x"), /no longer exists/);
console.log("ALL AI TESTS PASSED");
