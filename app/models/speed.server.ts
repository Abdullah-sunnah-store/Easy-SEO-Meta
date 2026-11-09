// Storefront speed tests through Google PageSpeed Insights (Lighthouse + real
// visitor data from the Chrome UX Report). Free API, but set PAGESPEED_API_KEY
// on the host (an AIza… key from Google Cloud with the "PageSpeed Insights API"
// enabled, 25,000 tests/day free): keyless requests share one anonymous daily
// quota that is normally used up, so they fail with 429.
//
// One run = one page on one device and takes 10–40 s at Google, so the screen
// asks for runs one at a time and this route allows up to 60 s.

import { gql, type AdminClient } from "./admin.server";

export class SpeedError extends Error {}

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 55_000;

export type Strategy = "mobile" | "desktop";

export type Opportunity = { id: string; title: string; savingsMs: number; display: string; images: boolean };

export type SpeedResult = {
  score: number;
  lcpMs: number;
  fcpMs: number;
  tbtMs: number;
  siMs: number;
  clsX1000: number;
  fieldLcpMs: number;
  fieldInpMs: number;
  fieldClsX1000: number;
  fieldCategory: string;
  opportunities: Opportunity[];
};

export type Target = { label: string; url: string };

const TARGETS_QUERY = `#graphql
  query SeoSpeedTargets {
    shop { primaryDomain { url } }
    products(first: 1, sortKey: UPDATED_AT, reverse: true, query: "status:active") { nodes { handle title } }
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) { nodes { handle title } }
  }`;

/** Home page, the latest active product and the latest collection on the shop's own domain. */
export async function speedTargets(admin: AdminClient): Promise<{ base: string; targets: Target[] }> {
  const data = await gql<any>(admin, TARGETS_QUERY, {});
  const base = String(data?.shop?.primaryDomain?.url ?? "").replace(/\/+$/, "");
  const targets: Target[] = [{ label: "Home page", url: base + "/" }];
  const p = data?.products?.nodes?.[0];
  if (p?.handle) targets.push({ label: `Product: ${p.title}`, url: `${base}/products/${p.handle}` });
  const c = data?.collections?.nodes?.[0];
  if (c?.handle) targets.push({ label: `Collection: ${c.title}`, url: `${base}/collections/${c.handle}` });
  return { base, targets };
}

/** Only pages on the shop's own storefront may be tested (a path, or a full URL on `base`'s host). */
export function resolveCustomUrl(input: string, base: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const baseUrl = new URL(base);
    const u = raw.startsWith("/") ? new URL(raw, baseUrl) : new URL(raw);
    if (u.host !== baseUrl.host || !/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

const IMAGE_AUDIT = /image|img|offscreen|animated|lcp-discovery/i;

function opportunitiesFrom(lh: any): Opportunity[] {
  const audits = lh?.audits ?? {};
  const refs: any[] = lh?.categories?.performance?.auditRefs ?? [];
  const out: Opportunity[] = [];
  for (const ref of refs) {
    // Metric audits carry the score's weight; the rest are the advice.
    if (ref.weight > 0) continue;
    const a = audits[ref.id];
    if (!a || a.score === null || a.score === undefined || a.score >= 0.9) continue;
    if (a.scoreDisplayMode === "informative" || a.scoreDisplayMode === "notApplicable" || a.scoreDisplayMode === "manual") continue;
    const savingsMs = Math.round(
      a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? a.metricSavings?.FCP ?? (a.numericUnit === "millisecond" ? a.numericValue : 0) ?? 0,
    );
    out.push({ id: ref.id, title: String(a.title ?? ref.id), savingsMs, display: String(a.displayValue ?? ""), images: IMAGE_AUDIT.test(ref.id) });
  }
  return out.sort((x, y) => y.savingsMs - x.savingsMs).slice(0, 6);
}

/** Parses a PageSpeed Insights v5 response. Exported for tests. */
export function parsePageSpeed(json: any): SpeedResult {
  const lh = json?.lighthouseResult;
  if (!lh) throw new SpeedError("Google didn't return a result for this page.");
  const final = String(lh.finalDisplayedUrl ?? lh.finalUrl ?? "");
  if (/\/password(\b|$|\?)/.test(final)) {
    throw new SpeedError("Your storefront is password protected, so Google can't load it. Remove the password (Online Store → Preferences) and test again.");
  }
  const a = lh.audits ?? {};
  const num = (id: string) => Math.round(Number(a[id]?.numericValue ?? 0));
  const perf = lh.categories?.performance?.score;
  // Real-visitor data is only meaningful for this exact page (not the origin fallback).
  const le = json?.loadingExperience;
  const field = le && !le.origin_fallback ? le.metrics ?? {} : {};
  const p75 = (k: string) => (field[k]?.percentile !== undefined ? Math.round(Number(field[k].percentile)) : -1);
  const fieldCls = p75("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  return {
    score: typeof perf === "number" ? Math.round(perf * 100) : -1,
    lcpMs: num("largest-contentful-paint"),
    fcpMs: num("first-contentful-paint"),
    tbtMs: num("total-blocking-time"),
    siMs: num("speed-index"),
    clsX1000: Math.round(Number(a["cumulative-layout-shift"]?.numericValue ?? 0) * 1000),
    fieldLcpMs: p75("LARGEST_CONTENTFUL_PAINT_MS"),
    fieldInpMs: p75("INTERACTION_TO_NEXT_PAINT"),
    // CrUX reports CLS ×100.
    fieldClsX1000: fieldCls < 0 ? -1 : fieldCls * 10,
    fieldCategory: le && !le.origin_fallback ? String(le.overall_category ?? "") : "",
    opportunities: opportunitiesFrom(lh),
  };
}

export async function runPageSpeed(url: string, strategy: Strategy): Promise<SpeedResult> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key) params.set("key", key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
  } catch (error: any) {
    throw new SpeedError(error?.name === "AbortError" ? "Google took too long to test this page. Try again." : "Couldn't reach Google PageSpeed. Try again.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    // Keyless requests share one anonymous daily quota that is usually spent.
    throw new SpeedError(
      key
        ? "Google's speed-test limit is used up for the moment. Try again in a few minutes."
        : "Speed tests aren't set up yet (Google needs a PageSpeed API key on the app).",
    );
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(json?.error?.message ?? "");
    console.warn(`Easy SEO speed: PageSpeed ${res.status} for ${url}:`, msg.slice(0, 300));
    if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|DNS/i.test(msg)) {
      throw new SpeedError("Google couldn't load this page. Check that it opens in a browser and isn't password protected.");
    }
    if (/API key/i.test(msg)) throw new SpeedError("The PageSpeed API key isn't valid. Check PAGESPEED_API_KEY.");
    throw new SpeedError("Google PageSpeed couldn't test this page. Try again.");
  }
  return parsePageSpeed(json);
}

export function parseOpportunities(raw: string): Opportunity[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
