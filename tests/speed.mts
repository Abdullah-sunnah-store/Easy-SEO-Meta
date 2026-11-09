import assert from "node:assert";
import { isPasswordProtected, parsePageSpeed, resolveCustomUrl, runPageSpeed, speedTargets, SpeedError } from "../app/models/speed.server";

// Shape of a real PageSpeed Insights v5 response (Lighthouse 12/13 style).
const psi = (over: any = {}) => ({
  loadingExperience: {
    id: "https://acme.com/", overall_category: "AVERAGE",
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900, category: "AVERAGE" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: "FAST" },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
    },
  },
  lighthouseResult: {
    finalDisplayedUrl: "https://acme.com/",
    categories: { performance: { score: 0.62, auditRefs: [
      { id: "largest-contentful-paint", weight: 25 }, { id: "total-blocking-time", weight: 30 },
      { id: "image-delivery-insight", weight: 0 }, { id: "render-blocking-insight", weight: 0 },
      { id: "unused-javascript", weight: 0 }, { id: "font-display", weight: 0 }, { id: "diagnostics", weight: 0 },
    ] } },
    audits: {
      "largest-contentful-paint": { numericValue: 4123.4 }, "first-contentful-paint": { numericValue: 1650 },
      "total-blocking-time": { numericValue: 410 }, "speed-index": { numericValue: 3900 }, "cumulative-layout-shift": { numericValue: 0.031 },
      "image-delivery-insight": { title: "Improve image delivery", score: 0, scoreDisplayMode: "metricSavings", displayValue: "Est savings of 1,200 KiB", details: { overallSavingsMs: 1800 } },
      "render-blocking-insight": { title: "Render blocking requests", score: 0.5, scoreDisplayMode: "metricSavings", metricSavings: { FCP: 600, LCP: 600 } },
      "unused-javascript": { title: "Reduce unused JavaScript", score: 0.4, scoreDisplayMode: "metricSavings", numericUnit: "millisecond", numericValue: 900 },
      "font-display": { title: "Font display", score: 1, scoreDisplayMode: "metricSavings" },
      "diagnostics": { title: "Diagnostics", score: null, scoreDisplayMode: "informative" },
    },
    ...over,
  },
});

const r = parsePageSpeed(psi());
assert.equal(r.score, 62); assert.equal(r.lcpMs, 4123); assert.equal(r.tbtMs, 410); assert.equal(r.clsX1000, 31);
assert.equal(r.fieldLcpMs, 2900); assert.equal(r.fieldInpMs, 180); assert.equal(r.fieldClsX1000, 50); assert.equal(r.fieldCategory, "AVERAGE");
assert.deepEqual(r.opportunities.map((o) => o.id), ["image-delivery-insight", "unused-javascript", "render-blocking-insight"]);
assert.equal(r.opportunities[0].images, true); assert.equal(r.opportunities[1].images, false);
assert.equal(r.opportunities[0].savingsMs, 1800);

// origin fallback → no field data claimed for this page
const fb = psi(); (fb.loadingExperience as any).origin_fallback = true;
assert.equal(parsePageSpeed(fb).fieldLcpMs, -1);
// password page
assert.throws(() => parsePageSpeed(psi({ finalDisplayedUrl: "https://acme.com/password" })), /password protected/);

// only the shop's own pages
assert.equal(resolveCustomUrl("/pages/about", "https://acme.com"), "https://acme.com/pages/about");
assert.equal(resolveCustomUrl("https://acme.com/collections/all#x", "https://acme.com"), "https://acme.com/collections/all");
assert.equal(resolveCustomUrl("https://evil.com/", "https://acme.com"), null);
assert.equal(resolveCustomUrl("javascript:alert(1)", "https://acme.com"), null);
assert.equal(resolveCustomUrl("", "https://acme.com"), null);

// runPageSpeed: request shape, key, error mapping
let last = ""; let reply: { status: number; body: any } = { status: 200, body: psi() };
(globalThis as any).fetch = async (url: string) => { last = url; return new Response(JSON.stringify(reply.body), { status: reply.status }); };
process.env.PAGESPEED_API_KEY = " AIzaTest \n";
await runPageSpeed("https://acme.com/", "mobile");
const q = new URL(last).searchParams;
assert.equal(q.get("url"), "https://acme.com/"); assert.equal(q.get("strategy"), "mobile"); assert.equal(q.get("category"), "performance"); assert.equal(q.get("key"), "AIzaTest");
delete process.env.PAGESPEED_API_KEY;
await runPageSpeed("https://acme.com/", "desktop");
assert.equal(new URL(last).searchParams.get("key"), null);
reply = { status: 429, body: {} };
await assert.rejects(runPageSpeed("https://acme.com/", "mobile"), /aren't set up/);
process.env.PAGESPEED_API_KEY = "AIzaTest";
await assert.rejects(runPageSpeed("https://acme.com/", "mobile"), /limit is used up/);
delete process.env.PAGESPEED_API_KEY;
reply = { status: 500, body: { error: { message: "Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page" } } };
await assert.rejects(runPageSpeed("https://acme.com/", "mobile"), (e: any) => e instanceof SpeedError && /couldn't load this page/.test(e.message));

// targets from the Admin API
const admin: any = { graphql: async () => new Response(JSON.stringify({ data: {
  shop: { primaryDomain: { url: "https://acme.com/" } },
  products: { nodes: [{ handle: "linen-shirt", title: "Linen Shirt" }] },
  collections: { nodes: [{ handle: "summer", title: "Summer" }] },
} })) };
const t = await speedTargets(admin);
assert.equal(t.base, "https://acme.com");
assert.deepEqual(t.targets.map((x) => x.url), ["https://acme.com/", "https://acme.com/products/linen-shirt", "https://acme.com/collections/summer"]);
// password detection on the storefront home page
(globalThis as any).fetch = async () => new Response(null, { status: 302, headers: { location: "https://acme.com/password" } });
assert.equal(await isPasswordProtected("https://acme.com"), true);
(globalThis as any).fetch = async () => new Response("<html>", { status: 200 });
assert.equal(await isPasswordProtected("https://acme.com"), false);
(globalThis as any).fetch = async () => new Response(null, { status: 301, headers: { location: "https://www.acme.com/" } });
assert.equal(await isPasswordProtected("https://acme.com"), false);
(globalThis as any).fetch = async () => { throw new Error("offline"); };
assert.equal(await isPasswordProtected("https://acme.com"), false);
assert.equal(await isPasswordProtected(""), false);
console.log("ALL SPEED TESTS PASSED");
