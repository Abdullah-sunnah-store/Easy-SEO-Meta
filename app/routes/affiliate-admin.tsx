import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  FormLayout,
  InlineGrid,
  InlineStack,
  Tabs,
  Text,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import prisma from "../db.server";
import { AffiliateShell, Field, shellLinkStyle } from "../components/AffiliateShell";
import {
  accrueAll,
  accrueReferral,
  balanceOf,
  checkOwnerPassword,
  checkStore,
  commit,
  getSession,
  isOwner,
  ownerPasswordSet,
  type StoreCheck,
} from "../models/affiliate.server";
import { channelLabel, methodLabel, usd } from "../lib/affiliate";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta: MetaFunction = () => [{ title: "Affiliate admin — Easy SEO & Meta" }, { name: "robots", content: "noindex" }];

const TABS = ["referrals", "withdrawals", "affiliates", "commissions"] as const;
type Tab = (typeof TABS)[number];

function parseCheck(json: string): StoreCheck | null {
  try {
    return json ? (JSON.parse(json) as StoreCheck) : null;
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!ownerPasswordSet()) return { state: "closed" as const };
  if (!(await isOwner(request))) return { state: "login" as const };

  const url = new URL(request.url);
  const tab = (TABS as readonly string[]).includes(url.searchParams.get("tab") ?? "") ? (url.searchParams.get("tab") as Tab) : "referrals";

  const [pendingAffiliates, pendingReferrals, openWithdrawals] = await Promise.all([
    prisma.affiliate.count({ where: { status: "pending" } }),
    prisma.affiliateReferral.count({ where: { status: "pending" } }),
    prisma.affiliateWithdrawal.count({ where: { status: "requested" } }),
  ]);
  const counts = { pendingAffiliates, pendingReferrals, openWithdrawals };

  if (tab === "referrals") {
    const referrals = await prisma.affiliateReferral.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { affiliate: { select: { name: true, code: true, email: true, status: true } }, commissions: { select: { amount: true } } },
    });
    const shops = Array.from(new Set(referrals.map((r) => r.shop)));
    const [shopRefs, sameShop] = await Promise.all([
      prisma.shopReferral.findMany({ where: { shop: { in: shops } } }),
      prisma.affiliateReferral.groupBy({ by: ["shop"], where: { shop: { in: shops } }, _count: { _all: true } }),
    ]);
    const refByShop = new Map(shopRefs.map((s) => [s.shop, s]));
    const countByShop = new Map(sameShop.map((s) => [s.shop, s._count._all]));
    // Pending first, then approved, then the rest.
    const order: Record<string, number> = { pending: 0, approved: 1, ended: 2, rejected: 3 };
    referrals.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.createdAt.getTime() - a.createdAt.getTime());
    return {
      state: "in" as const,
      tab,
      counts,
      referrals: referrals.map((r) => ({
        id: r.id,
        affiliate: r.affiliate,
        shop: r.shop,
        storeUrl: r.storeUrl,
        storeName: r.storeName,
        plan: r.plan,
        installedOn: r.installedOn?.toISOString() ?? "",
        channel: r.channel,
        sourceUrl: r.sourceUrl,
        howReferred: r.howReferred,
        proof: r.proof,
        status: r.status,
        adminNote: r.adminNote,
        createdAt: r.createdAt.toISOString(),
        check: parseCheck(r.lastCheck),
        storeSaysCode: refByShop.get(r.shop)?.code ?? "",
        storeSaysVia: refByShop.get(r.shop)?.source ?? "",
        otherClaims: (countByShop.get(r.shop) ?? 1) - 1,
        earned: Math.round(r.commissions.reduce((s, c) => s + c.amount, 0) * 100) / 100,
      })),
    };
  }

  if (tab === "withdrawals") {
    const withdrawals = await prisma.affiliateWithdrawal.findMany({
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      take: 200,
      include: { affiliate: { select: { name: true, code: true, phone: true } } },
    });
    withdrawals.sort((a, b) => Number(b.status === "requested") - Number(a.status === "requested") || a.requestedAt.getTime() - b.requestedAt.getTime());
    return {
      state: "in" as const,
      tab,
      counts,
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        affiliate: w.affiliate,
        amount: w.amount,
        method: w.method,
        number: w.number,
        accountName: w.accountName,
        status: w.status,
        requestedAt: w.requestedAt.toISOString(),
        dueBy: w.dueBy.toISOString(),
        paidAt: w.paidAt?.toISOString() ?? "",
        bdtAmount: w.bdtAmount,
        trxId: w.trxId,
        adminNote: w.adminNote,
      })),
    };
  }

  if (tab === "affiliates") {
    const affiliates = await prisma.affiliate.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { _count: { select: { referrals: true } } },
    });
    const order: Record<string, number> = { pending: 0, approved: 1, suspended: 2, rejected: 3 };
    affiliates.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    const balances = await Promise.all(affiliates.map((a) => balanceOf(a.id)));
    return {
      state: "in" as const,
      tab,
      counts,
      affiliates: affiliates.map((a, i) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        phone: a.phone,
        code: a.code,
        status: a.status,
        adminNote: a.adminNote,
        payout: `${methodLabel(a.payoutMethod)} ${a.payoutNumber}${a.payoutName ? ` (${a.payoutName})` : ""}`,
        website: a.website,
        promotion: a.promotion,
        clicks: a.clicks,
        referrals: a._count.referrals,
        createdAt: a.createdAt.toISOString(),
        balance: balances[i],
      })),
    };
  }

  const [commissions, affiliates] = await Promise.all([
    prisma.affiliateCommission.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { affiliate: { select: { name: true, code: true } }, referral: { select: { storeUrl: true } } },
    }),
    prisma.affiliate.findMany({ where: { status: "approved" }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  return {
    state: "in" as const,
    tab,
    counts,
    affiliateOptions: affiliates,
    commissions: commissions.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      affiliate: c.affiliate,
      store: c.referral?.storeUrl ?? "",
      kind: c.kind,
      note: c.note,
      amount: c.amount,
    })),
  };
};

type ActionResult = { ok?: string; error?: string; id?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const id = get("id");

  if (intent === "login") {
    if (!checkOwnerPassword(String(form.get("password") ?? ""))) return { error: "Wrong password." };
    const session = await getSession(request);
    session.set("owner", true);
    return redirect("/affiliate-admin", { headers: await commit(session) });
  }
  if (!(await isOwner(request))) return { error: "Log in again." };
  if (intent === "logout") {
    const session = await getSession(request);
    session.unset("owner");
    return redirect("/affiliate-admin", { headers: await commit(session) });
  }

  const note = get("note").slice(0, 1000);

  switch (intent) {
    // Affiliates
    case "affiliate-approve":
    case "affiliate-reject":
    case "affiliate-suspend": {
      const status = intent.replace("affiliate-", "").replace("approve", "approved").replace("reject", "rejected").replace("suspend", "suspended");
      await prisma.affiliate.update({
        where: { id },
        data: { status, adminNote: note, ...(status === "approved" ? { approvedAt: new Date() } : {}) },
      });
      return { id, ok: `Affiliate ${status}.` };
    }

    // Referrals
    case "referral-check": {
      const referral = await prisma.affiliateReferral.findUnique({ where: { id } });
      if (!referral) return { id, error: "Not found." };
      const check = await checkStore(referral.shop || referral.storeUrl);
      await prisma.affiliateReferral.update({
        where: { id },
        data: { lastCheck: JSON.stringify(check), checkedAt: new Date(), ...(check.shop ? { shop: check.shop } : {}) },
      });
      return { id, ok: check.error ? `Checked: ${check.error}` : "Checked." };
    }
    case "referral-approve": {
      const referral = await prisma.affiliateReferral.findUnique({ where: { id } });
      if (!referral) return { id, error: "Not found." };
      const taken = await prisma.affiliateReferral.findFirst({
        where: { shop: referral.shop, status: "approved", NOT: { id } },
        include: { affiliate: { select: { name: true } } },
      });
      if (taken) return { id, error: `This store is already approved for ${taken.affiliate.name}. Reject or end that one first.` };
      await prisma.affiliateReferral.update({ where: { id }, data: { status: "approved", adminNote: note, reviewedAt: new Date() } });
      const out = await accrueReferral(id);
      return { id, ok: `Approved. ${out.message}` };
    }
    case "referral-reject":
    case "referral-end": {
      const status = intent === "referral-reject" ? "rejected" : "ended";
      await prisma.affiliateReferral.update({ where: { id }, data: { status, adminNote: note, reviewedAt: new Date() } });
      return { id, ok: status === "rejected" ? "Rejected." : "Ended: no more commission for this store." };
    }
    case "referral-accrue": {
      const out = await accrueReferral(id);
      return { id, ok: out.message };
    }
    case "accrue-all": {
      const results = await accrueAll();
      const added = results.filter((r) => r.added > 0);
      const total = added.reduce((s, r) => s + r.added, 0);
      return { ok: `Checked ${results.length} approved stores: added ${added.length} commission${added.length === 1 ? "" : "s"}, ${usd(total)} in total.` };
    }

    // Withdrawals
    case "withdrawal-paid": {
      const trxId = get("trxId").slice(0, 60);
      const bdt = get("bdtAmount") ? Number(get("bdtAmount")) : null;
      if (!trxId) return { id, error: "Enter the bKash / Nagad transaction ID." };
      if (bdt !== null && (!Number.isFinite(bdt) || bdt <= 0)) return { id, error: "Enter the taka amount you sent." };
      await prisma.affiliateWithdrawal.update({
        where: { id },
        data: { status: "paid", paidAt: new Date(), trxId, bdtAmount: bdt, adminNote: note },
      });
      return { id, ok: "Marked as paid." };
    }
    case "withdrawal-reject": {
      if (!note) return { id, error: "Say why, so the affiliate knows." };
      await prisma.affiliateWithdrawal.update({ where: { id }, data: { status: "rejected", adminNote: note } });
      return { id, ok: "Rejected: the amount is back in the affiliate's balance." };
    }

    // Manual adjustment
    case "adjustment": {
      const affiliateId = get("affiliateId");
      const amount = Math.round(Number(get("amount")) * 100) / 100;
      if (!affiliateId) return { error: "Choose an affiliate." };
      if (!Number.isFinite(amount) || amount === 0) return { error: "Enter an amount (negative to deduct)." };
      if (!note) return { error: "Add a note the affiliate will see." };
      await prisma.affiliateCommission.create({
        data: { affiliateId, period: `adj-${Date.now()}`, kind: "adjustment", amount, note },
      });
      return { ok: `Adjustment of ${usd(amount)} added.` };
    }
  }
  return { error: "Unknown action." };
};

const TONE: Record<string, "success" | "attention" | "critical" | "info" | undefined> = {
  approved: "success",
  paid: "success",
  pending: "attention",
  requested: "attention",
  rejected: "critical",
  suspended: "critical",
  ended: "info",
};

function day(iso: string) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

function ext(url: string) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer noopener">
      {url.length > 60 ? `${url.slice(0, 57)}…` : url}
    </a>
  ) : (
    "—"
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <InlineStack gap="200" wrap={false} blockAlign="start">
      <div style={{ minWidth: 150 }}>
        <Text as="span" tone="subdued">{label}</Text>
      </div>
      <div style={{ flex: 1, wordBreak: "break-word" }}>{children}</div>
    </InlineStack>
  );
}

function ActionForm({ intent, id, label, tone, note, extra, primary }: {
  intent: string;
  id?: string;
  label: string;
  tone?: "critical";
  note?: boolean;
  extra?: React.ReactNode;
  primary?: boolean;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === intent && nav.formData?.get("id") === (id ?? null);
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      {id && <input type="hidden" name="id" value={id} />}
      <InlineStack gap="200" blockAlign="end" wrap>
        {extra}
        {note && (
          <div style={{ minWidth: 220 }}>
            <Field label="Note" labelHidden name="note" placeholder="Note (shown to the affiliate)" autoComplete="off" />
          </div>
        )}
        <Button submit tone={tone} variant={primary ? "primary" : undefined} loading={busy}>
          {label}
        </Button>
      </InlineStack>
    </Form>
  );
}

function CheckResult({ check }: { check: StoreCheck | null }) {
  if (!check) return <Text as="span" tone="subdued">Not checked yet.</Text>;
  if (check.error && !check.installed) return <Text as="span" tone="critical">{check.error} ({day(check.at)})</Text>;
  return (
    <BlockStack gap="050">
      <InlineStack gap="200">
        <Badge tone="success">Installed</Badge>
        <Badge tone={check.plan && check.plan !== "Free" ? "success" : "attention"}>{check.plan || "unknown"}</Badge>
        {check.price > 0 && <Badge>{`$${check.price}/${check.cycle === "yearly" ? "year" : "month"}`}</Badge>}
        {check.test && <Badge tone="critical">Test charge</Badge>}
        {check.inTrial && <Badge tone="info">{`In trial until ${day(check.trialEnds)}`}</Badge>}
      </InlineStack>
      <Text as="span" variant="bodySm" tone="subdued">
        {check.shop}
        {check.periodEnd ? ` · current cycle ends ${day(check.periodEnd)}` : ""} · checked {day(check.at)}
      </Text>
      {check.error && <Text as="span" tone="critical">{check.error}</Text>}
    </BlockStack>
  );
}

export default function AffiliateAdmin() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const busy = useNavigation().state !== "idle";

  if (data.state === "closed") {
    return (
      <AffiliateShell>
        <Banner tone="warning" title="Affiliate admin is switched off">
          Set AFFILIATE_ADMIN_PASSWORD in the app's environment variables on Vercel, then redeploy.
        </Banner>
      </AffiliateShell>
    );
  }

  if (data.state === "login") {
    return (
      <AffiliateShell>
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="login" />
              <FormLayout>
                <Text as="h1" variant="headingLg">Affiliate admin</Text>
                {result?.error && <Banner tone="critical">{result.error}</Banner>}
                <Field label="Admin password" name="password" type="password" autoComplete="current-password" />
                <Button submit variant="primary" loading={busy}>Log in</Button>
              </FormLayout>
            </Form>
          </Card>
        </div>
      </AffiliateShell>
    );
  }

  const tabs = [
    { id: "referrals", content: `Stores${data.counts.pendingReferrals ? ` (${data.counts.pendingReferrals} new)` : ""}` },
    { id: "withdrawals", content: `Withdrawals${data.counts.openWithdrawals ? ` (${data.counts.openWithdrawals} to pay)` : ""}` },
    { id: "affiliates", content: `Affiliates${data.counts.pendingAffiliates ? ` (${data.counts.pendingAffiliates} new)` : ""}` },
    { id: "commissions", content: "Commissions" },
  ];
  const selected = Math.max(0, tabs.findIndex((t) => t.id === data.tab));
  const flash = (id?: string) =>
    result && (result.ok || result.error) && (result.id ?? undefined) === id ? (
      <Banner tone={result.ok ? "success" : "critical"}>{result.ok ?? result.error}</Banner>
    ) : null;

  return (
    <AffiliateShell
      right={
        <Form method="post" style={{ display: "inline" }}>
          <input type="hidden" name="intent" value="logout" />
          <button type="submit" style={{ ...shellLinkStyle, background: "none", border: 0, cursor: "pointer", font: "inherit" }}>
            Log out
          </button>
        </Form>
      }
    >
      <BlockStack gap="400">
        <Text as="h1" variant="headingXl">Affiliate admin</Text>
        <Tabs
          tabs={tabs}
          selected={selected}
          onSelect={(i) => {
            window.location.href = `/affiliate-admin?tab=${tabs[i].id}`;
          }}
        />
        {flash(undefined)}

        {data.tab === "referrals" && "referrals" in data && (
          <BlockStack gap="400">
            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Monthly commission check</Text>
                  <Text as="p" tone="subdued">
                    Reads every approved store's plan from Shopify and adds the commission for each paid billing cycle
                    not added yet (50% first, 10% after). Safe to run any time; a cycle is never paid twice.
                  </Text>
                </BlockStack>
                <ActionForm intent="accrue-all" label="Check all approved stores" primary />
              </InlineStack>
            </Card>

            {data.referrals.length === 0 && <Card><Text as="p" tone="subdued">No stores submitted yet.</Text></Card>}
            {data.referrals.map((r) => (
              <Card key={r.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">{r.storeName || r.storeUrl}</Text>
                      <Badge tone={TONE[r.status]}>{r.status}</Badge>
                    </InlineStack>
                    <Text as="span" tone="subdued">
                      {r.affiliate.name} ({r.affiliate.code}) · submitted {day(r.createdAt)} · earned {usd(r.earned)}
                    </Text>
                  </InlineStack>
                  {flash(r.id)}
                  <Row label="Store">{r.storeUrl}{r.shop && r.shop !== r.storeUrl ? ` → ${r.shop}` : ""}</Row>
                  <Row label="Plan (claimed)">{r.plan}</Row>
                  {r.installedOn && <Row label="Installed on">{day(r.installedOn)}</Row>}
                  <Row label="Referred via">{channelLabel(r.channel)}</Row>
                  <Row label="Post / website">{ext(r.sourceUrl)}</Row>
                  <Row label="How">{r.howReferred}</Row>
                  <Row label="Proof">{ext(r.proof)}</Row>
                  <Row label="Store's own record">
                    {r.storeSaysCode ? (
                      <Text as="span" tone={r.storeSaysCode === r.affiliate.code ? "success" : "critical"}>
                        Store used code {r.storeSaysCode} ({r.storeSaysVia === "link" ? "via referral link" : "typed in the app"})
                        {r.storeSaysCode === r.affiliate.code ? " — matches" : " — a DIFFERENT affiliate"}
                      </Text>
                    ) : (
                      <Text as="span" tone="subdued">The store didn't use any referral link or code.</Text>
                    )}
                  </Row>
                  {r.otherClaims > 0 && (
                    <Row label="Warning">
                      <Text as="span" tone="critical">{r.otherClaims} other submission(s) for this store.</Text>
                    </Row>
                  )}
                  <Row label="Live check"><CheckResult check={r.check} /></Row>
                  {r.adminNote && <Row label="Your note">{r.adminNote}</Row>}
                  <Divider />
                  <InlineStack gap="300" wrap>
                    <ActionForm intent="referral-check" id={r.id} label="Check store now" />
                    {r.status === "pending" && (
                      <>
                        <ActionForm intent="referral-approve" id={r.id} label="Approve" primary note />
                        <ActionForm intent="referral-reject" id={r.id} label="Reject" tone="critical" note />
                      </>
                    )}
                    {r.status === "approved" && (
                      <>
                        <ActionForm intent="referral-accrue" id={r.id} label="Add due commission" primary />
                        <ActionForm intent="referral-end" id={r.id} label="End (store left)" note />
                      </>
                    )}
                    {(r.status === "rejected" || r.status === "ended") && (
                      <ActionForm intent="referral-approve" id={r.id} label="Approve again" note />
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}

        {data.tab === "withdrawals" && "withdrawals" in data && (
          <BlockStack gap="400">
            {data.withdrawals.length === 0 && <Card><Text as="p" tone="subdued">No withdrawal requests yet.</Text></Card>}
            {data.withdrawals.map((w) => {
              const late = w.status === "requested" && new Date(w.dueBy).getTime() < Date.now();
              return (
                <Card key={w.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingMd">{usd(w.amount)} to {w.affiliate.name} ({w.affiliate.code})</Text>
                        <Badge tone={TONE[w.status]}>{w.status}</Badge>
                        {late && <Badge tone="critical">Overdue</Badge>}
                      </InlineStack>
                      <Text as="span" tone="subdued">Requested {day(w.requestedAt)} · pay by {day(w.dueBy)}</Text>
                    </InlineStack>
                    {flash(w.id)}
                    <Row label="Send to">
                      <Text as="span" fontWeight="semibold">
                        {methodLabel(w.method)} {w.number}{w.accountName ? ` (${w.accountName})` : ""}
                      </Text>
                    </Row>
                    <Row label="Affiliate phone">{w.affiliate.phone || "—"}</Row>
                    {w.status === "paid" && (
                      <Row label="Paid">
                        {day(w.paidAt)}{w.bdtAmount ? ` · ৳${w.bdtAmount.toLocaleString()}` : ""} · TrxID {w.trxId}
                      </Row>
                    )}
                    {w.adminNote && <Row label="Note">{w.adminNote}</Row>}
                    {w.status === "requested" && (
                      <>
                        <Divider />
                        <ActionForm
                          intent="withdrawal-paid"
                          id={w.id}
                          label="Mark as paid"
                          primary
                          extra={
                            <>
                              <div style={{ width: 200 }}>
                                <Field label="Transaction ID" name="trxId" autoComplete="off" />
                              </div>
                              <div style={{ width: 150 }}>
                                <Field label="Taka sent (৳)" name="bdtAmount" type="number" autoComplete="off" />
                              </div>
                            </>
                          }
                        />
                        <ActionForm intent="withdrawal-reject" id={w.id} label="Reject" tone="critical" note />
                      </>
                    )}
                  </BlockStack>
                </Card>
              );
            })}
          </BlockStack>
        )}

        {data.tab === "affiliates" && "affiliates" in data && (
          <BlockStack gap="400">
            {data.affiliates.length === 0 && <Card><Text as="p" tone="subdued">No affiliates yet.</Text></Card>}
            {data.affiliates.map((a) => (
              <Card key={a.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">{a.name}</Text>
                      <Badge>{a.code}</Badge>
                      <Badge tone={TONE[a.status]}>{a.status}</Badge>
                    </InlineStack>
                    <Text as="span" tone="subdued">Joined {day(a.createdAt)}</Text>
                  </InlineStack>
                  {flash(a.id)}
                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                    <BlockStack gap="150">
                      <Row label="Email">{a.email}</Row>
                      <Row label="Phone">{a.phone}</Row>
                      <Row label="Payout">{a.payout}</Row>
                      <Row label="Website / page">{a.website}</Row>
                      <Row label="How they'll promote">{a.promotion}</Row>
                    </BlockStack>
                    <BlockStack gap="150">
                      <Row label="Link clicks">{a.clicks.toLocaleString()}</Row>
                      <Row label="Stores submitted">{a.referrals}</Row>
                      <Row label="Earned">{usd(a.balance.earned)}</Row>
                      <Row label="Available">{usd(a.balance.available)}</Row>
                      <Row label="Paid out">{usd(a.balance.paid)}</Row>
                    </BlockStack>
                  </InlineGrid>
                  {a.adminNote && <Row label="Your note">{a.adminNote}</Row>}
                  <Divider />
                  <InlineStack gap="300" wrap>
                    {a.status !== "approved" && <ActionForm intent="affiliate-approve" id={a.id} label="Approve" primary note />}
                    {a.status === "pending" && <ActionForm intent="affiliate-reject" id={a.id} label="Reject" tone="critical" note />}
                    {a.status === "approved" && <ActionForm intent="affiliate-suspend" id={a.id} label="Suspend" tone="critical" note />}
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}

        {data.tab === "commissions" && "commissions" in data && (
          <BlockStack gap="400">
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="adjustment" />
                <FormLayout>
                  <Text as="h2" variant="headingMd">Manual adjustment</Text>
                  <Text as="p" tone="subdued">Add a bonus, or a negative amount to take back commission for a refunded payment.</Text>
                  <FormLayout.Group>
                    <div>
                      <label htmlFor="affiliateId"><Text as="span">Affiliate</Text></label>
                      <Box paddingBlockStart="100">
                        <select id="affiliateId" name="affiliateId" style={{ width: "100%", padding: 8, borderRadius: 8 }}>
                          <option value="">Choose…</option>
                          {data.affiliateOptions.map((a) => (
                            <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                          ))}
                        </select>
                      </Box>
                    </div>
                    <Field label="Amount (USD)" name="amount" type="number" step={0.01} autoComplete="off" />
                  </FormLayout.Group>
                  <Field label="Note (shown to the affiliate)" name="note" autoComplete="off" />
                  <Button submit loading={busy}>Add adjustment</Button>
                </FormLayout>
              </Form>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Recent commissions</Text>
                {data.commissions.length === 0 && <Text as="p" tone="subdued">None yet.</Text>}
                {data.commissions.map((c) => (
                  <InlineStack key={c.id} align="space-between" wrap={false} gap="300">
                    <Text as="span">
                      {day(c.createdAt)} · {c.affiliate.name} ({c.affiliate.code}) · {c.kind}
                      {c.store ? ` · ${c.store}` : ""} · {c.note}
                    </Text>
                    <Text as="span" fontWeight="semibold" tone={c.amount < 0 ? "critical" : undefined}>{usd(c.amount)}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        <Text as="p" tone="subdued">
          Public pages: <Link to="/affiliates">/affiliates</Link> · <Link to="/affiliates/terms">rules</Link>
        </Text>
      </BlockStack>
    </AffiliateShell>
  );
}
