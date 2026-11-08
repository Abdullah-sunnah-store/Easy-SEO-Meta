// Plans, limits and feature gates. Client-safe: no server imports.

export const PLANS = { BASIC: "Basic", ADVANCED: "Advanced" } as const;
export const FREE_PLAN = "Free";
export type PlanName = "Free" | "Basic" | "Advanced";
export type PaidPlanName = Exclude<PlanName, "Free">;
export type BillingCycle = "monthly" | "yearly";

// Cheapest → most expensive. Index doubles as the entitlement rank.
export const PLAN_ORDER: PlanName[] = [FREE_PLAN, PLANS.BASIC, PLANS.ADVANCED];

// Sellable subscriptions. `key` is the billing plan name in shopify.server.ts
// and the subscription name Shopify reports back — how a charge maps to a tier.
export const BILLING_PLANS: {
  key: string;
  tier: PaidPlanName;
  cycle: BillingCycle;
  amount: number;
  price: string;
  trialDays: number;
}[] = [
  { key: "Basic", tier: "Basic", cycle: "monthly", amount: 9.99, price: "$9.99", trialDays: 7 },
  { key: "Advanced", tier: "Advanced", cycle: "monthly", amount: 24.99, price: "$24.99", trialDays: 7 },
];

export function billingPlan(key: string) {
  return BILLING_PLANS.find((p) => p.key === key);
}

/** -1 = unlimited. Monthly counters reset on the 1st (UTC). */
export const PLAN_LIMITS: Record<
  PlanName,
  { auditItems: number; metaEdits: number; altEdits: number; compressions: number; aiGenerations: number }
> = {
  Free: { auditItems: 100, metaEdits: 50, altEdits: 50, compressions: 25, aiGenerations: 10 },
  Basic: { auditItems: -1, metaEdits: -1, altEdits: -1, compressions: 1000, aiGenerations: 300 },
  Advanced: { auditItems: -1, metaEdits: -1, altEdits: -1, compressions: 5000, aiGenerations: 1000 },
};

export type Feature =
  | "autoMeta" // fill SEO fields on new products automatically
  | "csvRedirects" // bulk-import redirects from CSV
  | "handleRedirects" // 301 when a product handle changes
  | "brokenLinks" // broken internal link report + one-click redirect
  | "allResources"; // audit collections, pages and articles too

export const FEATURE_MIN_PLAN: Record<Feature, PlanName> = {
  autoMeta: PLANS.BASIC,
  csvRedirects: PLANS.BASIC,
  handleRedirects: PLANS.BASIC,
  allResources: PLANS.BASIC,
  brokenLinks: PLANS.ADVANCED,
};

// What each plan card lists. Every line must be a feature that works today.
export const PLAN_FEATURES: Record<PlanName, string[]> = {
  Free: [
    "SEO audit & score (up to 100 products)",
    "Meta title & description editor",
    "10 AI-written titles & descriptions / month",
    "50 template meta edits / month",
    "50 image alt texts / month",
    "25 image compressions / month",
    "Redirect manager + auto-redirect deleted products",
    "llms.txt for AI search",
  ],
  Basic: [
    "Everything in Free",
    "Audit products, collections, pages & blog posts",
    "Unlimited bulk meta & alt text",
    "300 AI-written titles & descriptions / month",
    "Auto meta & alt for new products",
    "Auto 301 when a product URL changes",
    "CSV redirect import",
    "1,000 image compressions / month",
  ],
  Advanced: [
    "Everything in Basic",
    "Broken internal link finder + one-click fix",
    "1,000 AI-written titles & descriptions / month",
    "5,000 image compressions / month",
    "Priority support",
  ],
};

export function planRank(plan: PlanName): number {
  return PLAN_ORDER.indexOf(plan);
}

export function can(plan: PlanName, feature: Feature): boolean {
  return planRank(plan) >= planRank(FEATURE_MIN_PLAN[feature]);
}

export function limit(plan: PlanName, key: keyof (typeof PLAN_LIMITS)["Free"]): number {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free)[key];
}

export function formatLimit(n: number): string {
  return n < 0 ? "Unlimited" : n.toLocaleString("en-US");
}
