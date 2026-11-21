import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  FormLayout,
  InlineGrid,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import prisma from "../db.server";
import { AffiliateShell, Field, shellLinkStyle } from "../components/AffiliateShell";
import { balanceOf, payoutDueDate, requireAffiliate } from "../models/affiliate.server";
import {
  CHANNELS,
  MIN_WITHDRAW,
  PAID_TIERS,
  PAYOUT_DAYS_MAX,
  PAYOUT_DAYS_MIN,
  PAYOUT_METHODS,
  REFERRAL_TRIAL_BONUS,
  channelLabel,
  methodLabel,
  normalizeStore,
  safeUrl,
  usd,
} from "../lib/affiliate";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta: MetaFunction = () => [{ title: "Affiliate dashboard — Easy SEO & Meta" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const affiliate = await requireAffiliate(request);
  const [balance, referrals, commissions, withdrawals] = await Promise.all([
    balanceOf(affiliate.id),
    prisma.affiliateReferral.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: "desc" },
      include: { commissions: { select: { amount: true } } },
    }),
    prisma.affiliateCommission.findMany({ where: { affiliateId: affiliate.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.affiliateWithdrawal.findMany({ where: { affiliateId: affiliate.id }, orderBy: { requestedAt: "desc" } }),
  ]);
  const origin = new URL(request.url).origin;
  return {
    affiliate: {
      name: affiliate.name,
      email: affiliate.email,
      code: affiliate.code,
      status: affiliate.status,
      adminNote: affiliate.adminNote,
      clicks: affiliate.clicks,
      payoutMethod: affiliate.payoutMethod,
      payoutNumber: affiliate.payoutNumber,
      payoutName: affiliate.payoutName,
    },
    link: `${origin}/r/${affiliate.code}`,
    balance,
    referrals: referrals.map((r) => ({
      id: r.id,
      storeUrl: r.storeUrl,
      storeName: r.storeName,
      plan: r.plan,
      channel: r.channel,
      sourceUrl: r.sourceUrl,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt.toISOString(),
      earned: Math.round(r.commissions.reduce((s, c) => s + c.amount, 0) * 100) / 100,
    })),
    commissions: commissions.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      kind: c.kind,
      note: c.note,
      amount: c.amount,
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: w.amount,
      method: w.method,
      number: w.number,
      status: w.status,
      requestedAt: w.requestedAt.toISOString(),
      dueBy: w.dueBy.toISOString(),
      paidAt: w.paidAt?.toISOString() ?? "",
      trxId: w.trxId,
      bdtAmount: w.bdtAmount,
      adminNote: w.adminNote,
    })),
  };
};

type ActionResult = { ok?: string; error?: string; errors?: Partial<Record<string, string>>; intent?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const affiliate = await requireAffiliate(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const get = (k: string) => String(form.get(k) ?? "").trim();

  if (intent === "referral") {
    if (affiliate.status !== "approved") return { intent, error: "You can submit stores once your account is approved." };
    const storeUrl = get("storeUrl");
    const shop = normalizeStore(storeUrl);
    const errors: Partial<Record<string, string>> = {};
    if (!shop) errors.storeUrl = "Enter the store's address, e.g. mystore.myshopify.com or mystore.com.";
    if (!PAID_TIERS.includes(get("plan") as never)) errors.plan = "Choose the store's plan.";
    if (!CHANNELS.some((c) => c.value === get("channel"))) errors.channel = "Choose where you referred the store.";
    if (get("howReferred").length < 10) errors.howReferred = "Describe in a sentence or two how you referred this store.";
    const installedOn = get("installedOn");
    if (installedOn && Number.isNaN(Date.parse(installedOn))) errors.installedOn = "Enter a valid date.";
    if (Object.keys(errors).length) return { intent, errors };

    const dup = await prisma.affiliateReferral.findFirst({
      where: { affiliateId: affiliate.id, shop, status: { in: ["pending", "approved"] } },
      select: { id: true },
    });
    if (dup) return { intent, errors: { storeUrl: "You've already submitted this store." } };

    await prisma.affiliateReferral.create({
      data: {
        affiliateId: affiliate.id,
        shop,
        storeUrl: storeUrl.slice(0, 300),
        storeName: get("storeName").slice(0, 200),
        plan: get("plan"),
        installedOn: installedOn ? new Date(installedOn) : null,
        channel: get("channel"),
        sourceUrl: safeUrl(get("sourceUrl")).slice(0, 500),
        howReferred: get("howReferred").slice(0, 2000),
        proof: safeUrl(get("proof")).slice(0, 500),
      },
    });
    return { intent, ok: "Store submitted. We'll check it and update its status here." };
  }

  if (intent === "withdraw") {
    if (affiliate.status !== "approved") return { intent, error: "Your account isn't approved." };
    if (!affiliate.payoutNumber) return { intent, error: "Add your bKash or Nagad number first." };
    const open = await prisma.affiliateWithdrawal.count({ where: { affiliateId: affiliate.id, status: "requested" } });
    if (open) return { intent, error: "You already have a withdrawal waiting to be paid." };
    const { available } = await balanceOf(affiliate.id);
    const amount = Math.round(Number(get("amount")) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return { intent, error: "Enter an amount." };
    if (amount < MIN_WITHDRAW) return { intent, error: `The smallest withdrawal is ${usd(MIN_WITHDRAW)}.` };
    if (amount > available) return { intent, error: `You can withdraw up to ${usd(available)}.` };
    await prisma.affiliateWithdrawal.create({
      data: {
        affiliateId: affiliate.id,
        amount,
        method: affiliate.payoutMethod,
        number: affiliate.payoutNumber,
        accountName: affiliate.payoutName,
        dueBy: payoutDueDate(),
      },
    });
    return {
      intent,
      ok: `Withdrawal of ${usd(amount)} requested. We'll send it to your ${methodLabel(affiliate.payoutMethod)} ${affiliate.payoutNumber} within ${PAYOUT_DAYS_MIN}–${PAYOUT_DAYS_MAX} business days.`,
    };
  }

  if (intent === "payout") {
    const method = get("payoutMethod");
    const number = get("payoutNumber").replace(/[^0-9+]/g, "");
    if (!PAYOUT_METHODS.some((m) => m.value === method)) return { intent, error: "Choose bKash or Nagad." };
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(number)) return { intent, error: "Enter a valid Bangladeshi mobile number (01XXXXXXXXX)." };
    await prisma.affiliate.update({
      where: { id: affiliate.id },
      data: { payoutMethod: method, payoutNumber: number, payoutName: get("payoutName").slice(0, 120) },
    });
    return { intent, ok: "Payment details saved. Withdrawals you request from now on go to this number." };
  }

  return { error: "Unknown action." };
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical" | "info" | undefined> = {
  approved: "success",
  paid: "success",
  pending: "attention",
  requested: "attention",
  rejected: "critical",
  suspended: "critical",
  ended: "info",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

function day(iso: string) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export default function AffiliateDashboard() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busyIntent = nav.state !== "idle" ? String(nav.formData?.get("intent") ?? "") : "";
  const a = data.affiliate;
  const approved = a.status === "approved";

  const [plan, setPlan] = useState(PAID_TIERS[0] ?? "Basic");
  const [channel, setChannel] = useState("facebook");
  const [method, setMethod] = useState(a.payoutMethod);
  const [amount, setAmount] = useState(String(data.balance.available || ""));
  const [formKey, setFormKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (result?.intent === "referral" && result.ok) setFormKey((k) => k + 1);
  }, [result]);
  useEffect(() => setAmount(String(data.balance.available || "")), [data.balance.available]);

  const errs = (result?.intent === "referral" && result.errors) || {};
  const message = (intent: string) =>
    result?.intent === intent && (result.ok || result.error) ? (
      <Banner tone={result.ok ? "success" : "critical"}>{result.ok ?? result.error}</Banner>
    ) : null;

  const copy = () => {
    navigator.clipboard?.writeText(data.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <AffiliateShell
      right={
        <span>
          <a href="/affiliates/terms" style={shellLinkStyle}>Rules</a>
          <a href="/affiliates/logout" style={shellLinkStyle}>Log out</a>
        </span>
      }
    >
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h1" variant="headingXl">Hi {a.name.split(" ")[0]}</Text>
          <StatusBadge status={a.status} />
        </InlineStack>

        {a.status === "pending" && (
          <Banner tone="info" title="Your application is being reviewed">
            We usually review applications within 2 business days. You can submit stores once you're approved.
          </Banner>
        )}
        {(a.status === "rejected" || a.status === "suspended") && (
          <Banner tone="critical" title={`Your account is ${a.status}`}>
            {a.adminNote || "Contact us if you think this is a mistake."}
          </Banner>
        )}

        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          {[
            { label: "Available to withdraw", value: usd(data.balance.available) },
            { label: "Waiting to be paid", value: usd(data.balance.requested) },
            { label: "Paid to you", value: usd(data.balance.paid) },
            { label: "Total earned", value: usd(data.balance.earned) },
          ].map((s) => (
            <Card key={s.label}>
              <BlockStack gap="100">
                <Text as="span" tone="subdued">{s.label}</Text>
                <Text as="p" variant="headingXl">{s.value}</Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {approved && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Your referral link and code</Text>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                  <Text as="span" fontWeight="semibold">{data.link}</Text>
                </Box>
                <Button onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
              </InlineStack>
              <Text as="p">
                Code: <strong>{a.code}</strong> · {a.clicks.toLocaleString()} link clicks
              </Text>
              <Text as="p" tone="subdued">
                Stores that open the app through your link, or enter your code on the app's Home page, get{" "}
                {REFERRAL_TRIAL_BONUS} extra free-trial days, and we can confirm the referral faster.
              </Text>
            </BlockStack>
          </Card>
        )}

        <Card>
          <Form method="post" key={formKey}>
            <input type="hidden" name="intent" value="referral" />
            <FormLayout>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Submit a store you referred</Text>
                <Text as="p" tone="subdued">Tell us which store, which plan it uses, and where and how you referred it.</Text>
              </BlockStack>
              {message("referral")}
              <FormLayout.Group>
                <Field label="Store address" name="storeUrl" placeholder="mystore.myshopify.com or mystore.com" autoComplete="off" error={errs.storeUrl} disabled={!approved} />
                <Field label="Store name (optional)" name="storeName" autoComplete="off" disabled={!approved} />
              </FormLayout.Group>
              <FormLayout.Group>
                <Select label="Plan the store uses" name="plan" options={PAID_TIERS.map((t) => ({ label: t, value: t }))} value={plan} onChange={(v) => setPlan(v as typeof plan)} error={errs.plan} disabled={!approved} />
                <Field label="Installed on (optional)" name="installedOn" type="date" autoComplete="off" error={errs.installedOn} disabled={!approved} />
              </FormLayout.Group>
              <FormLayout.Group>
                <Select label="Where you referred it" name="channel" options={CHANNELS} value={channel} onChange={setChannel} error={errs.channel} disabled={!approved} />
                <Field label="Link to the post, video or website (optional)" name="sourceUrl" placeholder="https://" autoComplete="off" disabled={!approved} />
              </FormLayout.Group>
              <Field
                label="How did you refer this store?"
                name="howReferred"
                multiline={3}
                autoComplete="off"
                placeholder="e.g. The owner saw my Facebook post in 'Shopify Sellers BD' and messaged me; I helped them install it."
                error={errs.howReferred}
                disabled={!approved}
              />
              <Field label="Proof link (optional)" name="proof" placeholder="Link to a screenshot or chat" autoComplete="off" disabled={!approved} />
              <Button submit variant="primary" loading={busyIntent === "referral"} disabled={!approved}>
                Submit store
              </Button>
            </FormLayout>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Your stores</Text>
            {data.referrals.length === 0 ? (
              <Text as="p" tone="subdued">No stores submitted yet.</Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric"]}
                headings={["Store", "Plan", "Referred via", "Status", "Earned"]}
                rows={data.referrals.map((r) => [
                  <BlockStack key="s" gap="050">
                    <Text as="span" fontWeight="semibold">{r.storeName || r.storeUrl}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">Submitted {day(r.createdAt)}</Text>
                  </BlockStack>,
                  r.plan,
                  channelLabel(r.channel),
                  <BlockStack key="st" gap="050">
                    <StatusBadge status={r.status} />
                    {r.adminNote && <Text as="span" variant="bodySm" tone="subdued">{r.adminNote}</Text>}
                  </BlockStack>,
                  usd(r.earned),
                ])}
              />
            )}
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="withdraw" />
              <FormLayout>
                <Text as="h2" variant="headingMd">Withdraw</Text>
                {message("withdraw")}
                <TextField
                  label="Amount (USD)"
                  name="amount"
                  type="number"
                  min={MIN_WITHDRAW}
                  step={0.01}
                  value={amount}
                  onChange={setAmount}
                  autoComplete="off"
                  helpText={`Minimum ${usd(MIN_WITHDRAW)} · paid in taka to your ${methodLabel(a.payoutMethod)} ${a.payoutNumber || "(add a number)"} within ${PAYOUT_DAYS_MIN}–${PAYOUT_DAYS_MAX} business days.`}
                  disabled={!approved}
                />
                <Button submit variant="primary" loading={busyIntent === "withdraw"} disabled={!approved || data.balance.available < MIN_WITHDRAW}>
                  Request withdrawal
                </Button>
              </FormLayout>
            </Form>
          </Card>

          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="payout" />
              <FormLayout>
                <Text as="h2" variant="headingMd">Payment details</Text>
                {message("payout")}
                <FormLayout.Group>
                  <Select label="Method" name="payoutMethod" options={PAYOUT_METHODS} value={method} onChange={setMethod} />
                  <Field label="Number" name="payoutNumber" type="tel" defaultValue={a.payoutNumber} autoComplete="off" placeholder="01XXXXXXXXX" />
                </FormLayout.Group>
                <Field label="Account name (optional)" name="payoutName" defaultValue={a.payoutName} autoComplete="off" />
                <Button submit loading={busyIntent === "payout"}>Save</Button>
              </FormLayout>
            </Form>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Withdrawals</Text>
            {data.withdrawals.length === 0 ? (
              <Text as="p" tone="subdued">No withdrawals yet.</Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text", "text"]}
                headings={["Requested", "Amount", "To", "Status", "Details"]}
                rows={data.withdrawals.map((w) => [
                  day(w.requestedAt),
                  usd(w.amount),
                  `${methodLabel(w.method)} ${w.number}`,
                  <StatusBadge key="s" status={w.status} />,
                  w.status === "paid"
                    ? `Paid ${day(w.paidAt)}${w.bdtAmount ? ` · ৳${w.bdtAmount.toLocaleString()}` : ""}${w.trxId ? ` · TrxID ${w.trxId}` : ""}`
                    : w.status === "requested"
                      ? `Will be paid by ${day(w.dueBy)}`
                      : w.adminNote || "",
                ])}
              />
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Commission history</Text>
            {data.commissions.length === 0 ? (
              <Text as="p" tone="subdued">Commission appears here after a store you referred pays for a plan and we approve it.</Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric"]}
                headings={["Date", "Type", "Details", "Amount"]}
                rows={data.commissions.map((c) => [
                  day(c.createdAt),
                  c.kind === "first" ? "First payment (50%)" : c.kind === "recurring" ? "Monthly (10%)" : "Adjustment",
                  c.note,
                  usd(c.amount),
                ])}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </AffiliateShell>
  );
}
