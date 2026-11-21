import crypto from "node:crypto";
import { createCookie, createCookieSessionStorage, redirect } from "@remix-run/node";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { billingPlan } from "../lib/plans";
import {
  PAYOUT_DAYS_MAX,
  addBusinessDays,
  cleanCode,
  codeFromName,
  commissionForCycle,
  isMyshopify,
  normalizeStore,
} from "../lib/affiliate";

// ---------------------------------------------------------------------------
// Sessions: one signed cookie for affiliates and for you (the owner).
// ---------------------------------------------------------------------------

function secret() {
  return process.env.AFFILIATE_SECRET?.trim() || process.env.SHOPIFY_API_SECRET?.trim() || "dev-only-secret";
}

const storage = createCookieSessionStorage({
  cookie: {
    name: "esm_aff",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secrets: [secret()],
  },
});

export async function getSession(request: Request) {
  return storage.getSession(request.headers.get("Cookie"));
}

export async function commit(session: Awaited<ReturnType<typeof getSession>>) {
  return { "Set-Cookie": await storage.commitSession(session) };
}

export async function destroy(session: Awaited<ReturnType<typeof getSession>>) {
  return { "Set-Cookie": await storage.destroySession(session) };
}

// ---------------------------------------------------------------------------
// Passwords (scrypt, per-user salt)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function sameText(a: string, b: string) {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Who is signed in
// ---------------------------------------------------------------------------

export async function currentAffiliate(request: Request) {
  const session = await getSession(request);
  const id = session.get("affiliateId");
  if (!id) return null;
  return prisma.affiliate.findUnique({ where: { id: String(id) } });
}

export async function requireAffiliate(request: Request) {
  const affiliate = await currentAffiliate(request);
  if (!affiliate) throw redirect("/affiliates/login");
  return affiliate;
}

/** The owner's admin password; the admin page is closed when it isn't set. */
export function ownerPasswordSet() {
  return Boolean(process.env.AFFILIATE_ADMIN_PASSWORD?.trim());
}

export function checkOwnerPassword(password: string) {
  const expected = process.env.AFFILIATE_ADMIN_PASSWORD?.trim();
  return Boolean(expected) && sameText(password, expected!);
}

export async function isOwner(request: Request) {
  if (!ownerPasswordSet()) return false;
  const session = await getSession(request);
  return session.get("owner") === true;
}

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

export async function uniqueCode(name: string): Promise<string> {
  const base = codeFromName(name);
  for (let i = 0; i < 20; i++) {
    const code = i === 0 ? base : `${base.slice(0, 8)}${crypto.randomInt(10, 99)}`;
    const taken = await prisma.affiliate.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  return `${base.slice(0, 6)}${crypto.randomInt(1000, 9999)}`;
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export async function balanceOf(affiliateId: string) {
  const [earned, requested, paid] = await Promise.all([
    prisma.affiliateCommission.aggregate({ where: { affiliateId }, _sum: { amount: true } }),
    prisma.affiliateWithdrawal.aggregate({ where: { affiliateId, status: "requested" }, _sum: { amount: true } }),
    prisma.affiliateWithdrawal.aggregate({ where: { affiliateId, status: "paid" }, _sum: { amount: true } }),
  ]);
  const e = earned._sum.amount ?? 0;
  const r = requested._sum.amount ?? 0;
  const p = paid._sum.amount ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { earned: round(e), requested: round(r), paid: round(p), available: round(e - r - p) };
}

export function payoutDueDate(from = new Date()) {
  return addBusinessDays(from, PAYOUT_DAYS_MAX);
}

// ---------------------------------------------------------------------------
// Attribution from the store's side
// ---------------------------------------------------------------------------

export const refCookie = createCookie("esm_ref", {
  // Read inside the Shopify admin iframe, so it must be a cross-site cookie.
  sameSite: "none",
  secure: true,
  httpOnly: true,
  path: "/",
  maxAge: 60 * 60 * 24 * 60,
});

/** Record that a store arrived through an approved affiliate. First one wins. */
export async function attributeShop(shop: string, rawCode: string, source: "link" | "code") {
  const code = cleanCode(rawCode);
  if (!code) return { ok: false as const, error: "Enter a referral code." };
  const affiliate = await prisma.affiliate.findUnique({ where: { code }, select: { status: true } });
  if (!affiliate || affiliate.status !== "approved") return { ok: false as const, error: "That referral code isn't valid." };
  const existing = await prisma.shopReferral.findUnique({ where: { shop } });
  if (existing) return { ok: existing.code === code, error: existing.code === code ? undefined : "A referral code is already applied to this store." };
  await prisma.shopReferral.create({ data: { shop, code, source } });
  return { ok: true as const };
}

export async function shopReferralOf(shop: string) {
  return prisma.shopReferral.findUnique({ where: { shop } });
}

// ---------------------------------------------------------------------------
// Checking a store
// ---------------------------------------------------------------------------

export type StoreCheck = {
  at: string;
  shop: string;
  installed: boolean;
  plan: string; // Free | Basic | Advanced | ""
  price: number;
  cycle: "monthly" | "yearly";
  test: boolean;
  inTrial: boolean;
  trialEnds: string;
  periodEnd: string;
  referredBy: string; // code the store itself reported, or ""
  referredVia: string; // link | code | ""
  error: string;
};

/**
 * A custom domain → its myshopify domain, read from the storefront's HTML
 * (Shopify themes print `Shopify.shop = "x.myshopify.com"`).
 */
export async function resolveMyshopify(host: string): Promise<string> {
  if (!host) return "";
  if (isMyshopify(host)) return host;
  try {
    const res = await fetch(`https://${host}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "EasySEO-AffiliateCheck/1.0" },
    });
    const html = (await res.text()).slice(0, 400_000);
    const m = html.match(/Shopify\.shop\s*=\s*["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

/** Whether the store has the app, and its live plan, straight from Shopify. */
export async function checkStore(storeInput: string): Promise<StoreCheck> {
  const result: StoreCheck = {
    at: new Date().toISOString(),
    shop: "",
    installed: false,
    plan: "",
    price: 0,
    cycle: "monthly",
    test: false,
    inTrial: false,
    trialEnds: "",
    periodEnd: "",
    referredBy: "",
    referredVia: "",
    error: "",
  };
  const host = normalizeStore(storeInput);
  const shop = await resolveMyshopify(host);
  if (!shop) {
    result.error = host ? `Couldn't find the myshopify address of ${host}. Ask the affiliate for it.` : "No store address.";
    return result;
  }
  result.shop = shop;

  const ref = await prisma.shopReferral.findUnique({ where: { shop } });
  if (ref) {
    result.referredBy = ref.code;
    result.referredVia = ref.source;
  }

  const session = await prisma.session.findFirst({ where: { shop, isOnline: false }, select: { id: true } });
  if (!session) {
    result.error = "The app is not installed on this store.";
    return result;
  }
  result.installed = true;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query AffiliateCheck {
        currentAppInstallation {
          activeSubscriptions {
            name status test trialDays createdAt currentPeriodEnd
            lineItems { plan { pricingDetails { ... on AppRecurringPricing { price { amount } } } } }
          }
        }
      }`,
    );
    const body: any = await response.json();
    const subs: any[] = (body?.data?.currentAppInstallation?.activeSubscriptions ?? []).filter((s: any) => s?.status === "ACTIVE");
    const sub = subs.find((s) => billingPlan(s.name)) ?? subs[0];
    if (!sub) {
      result.plan = "Free";
      return result;
    }
    const tier = billingPlan(sub.name)?.tier ?? sub.name;
    const price = Number(sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount ?? billingPlan(sub.name)?.amount ?? 0);
    const trialEnd = new Date(new Date(sub.createdAt).getTime() + Number(sub.trialDays || 0) * 86_400_000);
    result.plan = tier;
    result.price = price;
    result.cycle = billingPlan(sub.name)?.cycle ?? (/year/i.test(sub.name) ? "yearly" : "monthly");
    result.test = Boolean(sub.test);
    result.inTrial = trialEnd.getTime() > Date.now();
    result.trialEnds = Number(sub.trialDays) > 0 ? trialEnd.toISOString() : "";
    result.periodEnd = sub.currentPeriodEnd ? String(sub.currentPeriodEnd) : "";
  } catch (error) {
    result.error = `Couldn't read the plan: ${(error as Error)?.message || error}`;
  }
  return result;
}

/** Test charges (development stores) only count when this is switched on for testing. */
function testChargesCount() {
  return process.env.AFFILIATE_ALLOW_TEST_CHARGES === "true";
}

/**
 * Adds the commission for the store's current paid billing cycle, if it isn't
 * there yet: 50% for the first paid cycle, 10% for every one after. Each cycle
 * is keyed by its end date, so running this daily or monthly never pays a
 * cycle twice.
 */
export async function accrueReferral(referralId: string): Promise<{ added: number; message: string; check?: StoreCheck }> {
  const referral = await prisma.affiliateReferral.findUnique({ where: { id: referralId }, include: { affiliate: true } });
  if (!referral) return { added: 0, message: "Referral not found." };
  if (referral.status !== "approved") return { added: 0, message: "Approve the referral first." };
  if (referral.affiliate.status !== "approved") return { added: 0, message: "The affiliate isn't approved." };

  const check = await checkStore(referral.shop || referral.storeUrl);
  await prisma.affiliateReferral.update({
    where: { id: referral.id },
    data: { lastCheck: JSON.stringify(check), checkedAt: new Date(), ...(check.shop ? { shop: check.shop } : {}) },
  });

  if (check.error) return { added: 0, message: check.error, check };
  if (!check.plan || check.plan === "Free" || check.price <= 0) return { added: 0, message: "The store is not on a paid plan.", check };
  if (check.test && !testChargesCount()) return { added: 0, message: "Test charge (development store): no commission.", check };
  if (check.inTrial) return { added: 0, message: `Still in the free trial until ${check.trialEnds.slice(0, 10)}.`, check };
  if (!check.periodEnd) return { added: 0, message: "Shopify didn't report the billing cycle.", check };

  const period = check.periodEnd.slice(0, 10);
  const exists = await prisma.affiliateCommission.findUnique({
    where: { referralId_period: { referralId: referral.id, period } },
  });
  if (exists) return { added: 0, message: `Already added for the cycle ending ${period}.`, check };

  const paidBefore = await prisma.affiliateCommission.count({ where: { referralId: referral.id, kind: { in: ["first", "recurring"] } } });
  const { rate, amount } = commissionForCycle(check.price, paidBefore === 0, check.cycle);
  try {
    await prisma.affiliateCommission.create({
      data: {
        affiliateId: referral.affiliateId,
        referralId: referral.id,
        period,
        kind: paidBefore === 0 ? "first" : "recurring",
        rate,
        baseAmount: check.price,
        amount,
        note: `${check.plan} ${check.cycle} $${check.price} — cycle ending ${period}`,
      },
    });
  } catch {
    // Unique (referralId, period): added by a parallel run.
    return { added: 0, message: `Already added for the cycle ending ${period}.`, check };
  }
  return { added: amount, message: `Added ${(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}% = $${amount.toFixed(2)} for the ${check.cycle} cycle ending ${period}.`, check };
}

/** Runs accrueReferral over every approved referral. */
export async function accrueAll() {
  const referrals = await prisma.affiliateReferral.findMany({
    where: { status: "approved", affiliate: { status: "approved" } },
    select: { id: true },
  });
  const results: { id: string; added: number; message: string }[] = [];
  for (const r of referrals) {
    const out = await accrueReferral(r.id);
    results.push({ id: r.id, added: out.added, message: out.message });
  }
  return results;
}
