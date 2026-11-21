// Affiliate program constants and pure helpers. Client-safe: no server imports.

import { BILLING_PLANS } from "./plans";

/** Share of the first paid billing cycle. */
export const FIRST_RATE = 0.5;
/** Share of every paid billing cycle after the first, for as long as the store pays. */
export const RECURRING_RATE = 0.1;
/** Smallest withdrawal, USD. */
export const MIN_WITHDRAW = 10;
/** Extra free-trial days a store gets for arriving through an affiliate. */
export const REFERRAL_TRIAL_BONUS = 7;
/** Withdrawals are paid within this many business days. */
export const PAYOUT_DAYS_MIN = 7;
export const PAYOUT_DAYS_MAX = 10;

export const LISTING_URL = "https://apps.shopify.com/easy-seo-meta";

export const CHANNELS: { value: string; label: string }[] = [
  { value: "facebook", label: "Facebook (page, group or post)" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "website", label: "Website or blog" },
  { value: "whatsapp", label: "WhatsApp / Messenger" },
  { value: "personal", label: "Personally (client, friend, colleague)" },
  { value: "other", label: "Other" },
];

export const PAYOUT_METHODS: { value: string; label: string }[] = [
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
];

export function channelLabel(value: string) {
  return CHANNELS.find((c) => c.value === value)?.label ?? value;
}

export function methodLabel(value: string) {
  return PAYOUT_METHODS.find((m) => m.value === value)?.label ?? value;
}

/** Monthly price of a paid tier, for the referral form. */
export function planPrice(tier: string): number {
  return BILLING_PLANS.find((p) => p.tier === tier && p.cycle === "monthly")?.amount ?? 0;
}

export const PAID_TIERS = Array.from(new Set(BILLING_PLANS.map((p) => p.tier)));

/** Commission for one paid billing cycle, rounded to cents. */
export function commissionFor(price: number, isFirst: boolean) {
  const rate = isFirst ? FIRST_RATE : RECURRING_RATE;
  // In whole cents: 9.99 * 0.5 in floating point is 4.99499…, which would round down.
  return { rate, amount: Math.round(Math.round(price * 100) * rate) / 100 };
}

/**
 * Commission for one paid billing cycle of a given length. A yearly payment
 * counts as 12 months: the first year pays FIRST_RATE of one month plus
 * RECURRING_RATE of the other eleven; every renewal pays RECURRING_RATE.
 */
export function commissionForCycle(price: number, isFirst: boolean, cycle: "monthly" | "yearly") {
  if (cycle !== "yearly") return commissionFor(price, isFirst);
  const cents = Math.round(price * 100);
  const rate = isFirst ? (FIRST_RATE + 11 * RECURRING_RATE) / 12 : RECURRING_RATE;
  return { rate, amount: Math.round(cents * rate) / 100 };
}

export function usd(n: number) {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

/**
 * The date a withdrawal must be paid by: PAYOUT_DAYS_MAX business days later.
 * Bangladesh's weekend is Friday and Saturday.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay(); // 5 = Fri, 6 = Sat
    if (wd !== 5 && wd !== 6) left -= 1;
  }
  return d;
}

/**
 * Normalise what someone typed as a store address: "https://Shop.com/x",
 * "shop.myshopify.com", "admin.shopify.com/store/shop" → a bare lowercase host
 * (or "<handle>.myshopify.com" for an admin URL). Empty when unusable.
 */
export function normalizeStore(input: string): string {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const admin = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) return `${admin[1]}.myshopify.com`;
  s = s.replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return "";
  return s;
}

export function isMyshopify(host: string) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host);
}

/** Referral code from a name: letters/digits, 4–10 chars, upper case. */
export function codeFromName(name: string): string {
  const base = String(name || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 10);
  return base.length >= 4 ? base : (base + "SEO").slice(0, 10);
}

export function cleanCode(input: string): string {
  return String(input || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

/** The safe public form of a URL someone submitted: http(s) only, else empty. */
export function safeUrl(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}
