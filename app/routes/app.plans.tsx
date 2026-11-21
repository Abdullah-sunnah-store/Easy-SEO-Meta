import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Button, ButtonGroup, Badge, List, Box } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { FREE_PLAN, PLAN_FEATURES, PLAN_ORDER, billingPlan, offerFor, yearlySaving, type BillingCycle, type PlanName } from "../lib/plans";
import { BILLING_TEST, cancelAllSubscriptions, forgetCachedPlan, getActiveSubscription } from "../models/billing.server";
import { shopReferralOf } from "../models/affiliate.server";
import { REFERRAL_TRIAL_BONUS } from "../lib/affiliate";

const TAGLINES: Record<PlanName, string> = {
  Free: "Get the basics right",
  Basic: "For growing stores",
  Advanced: "For catalogues that change a lot",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  forgetCachedPlan(session.shop);
  const [{ plan, key, cycle }, referral] = await Promise.all([getActiveSubscription(admin), shopReferralOf(session.shop)]);
  return { active: plan, activeKey: key, activeCycle: cycle, isTest: BILLING_TEST, trialBonus: referral ? REFERRAL_TRIAL_BONUS : 0 };
};

/** Shopify's own reason, e.g. the app's distribution isn't set to public yet. */
function billingErrorText(error: any): string {
  const data = error?.errorData;
  const messages: string[] = [];
  const collect = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === "object") (v.message ? messages.push(String(v.message)) : Object.values(v).forEach(collect));
  };
  collect(data);
  return messages.join(" ") || error?.message || "Shopify couldn't start the subscription.";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  forgetCachedPlan(session.shop);
  const key = String((await request.formData()).get("plan"));
  try {
    if (key === FREE_PLAN) {
      // Straight from the Admin API: billing.check() filters by isTest, so on a
      // review/development store it found no "real" charge and cancelled nothing.
      const error = await cancelAllSubscriptions(admin);
      forgetCachedPlan(session.shop);
      if (error) return { error: `Shopify said: ${error}` };
      return redirect("/app/plans");
    }
    if (!billingPlan(key)) return { error: "Unknown plan." };
    // On success this throws a redirect to Shopify's approval page.
    // Stores that came through an affiliate get extra trial days.
    // A store already on a paid plan that switches tier or billing cycle gets
    // no second trial.
    const [referral, current] = await Promise.all([shopReferralOf(session.shop), getActiveSubscription(admin)]);
    const trialDays =
      current.plan !== FREE_PLAN ? 0 : billingPlan(key)!.trialDays + (referral ? REFERRAL_TRIAL_BONUS : 0);
    await billing.request({ plan: key as never, isTest: BILLING_TEST, trialDays } as never);
    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    const reason = billingErrorText(error);
    console.error(`Easy SEO billing: ${key} failed for ${session.shop}:`, reason, JSON.stringify((error as any)?.errorData ?? null));
    return { error: `Shopify said: ${reason}` };
  }
};

export default function PlansPage() {
  const { active, activeKey, activeCycle, isTest, trialBonus } = useLoaderData<typeof loader>();
  const [cycle, setCycle] = useState<BillingCycle>(activeCycle ?? "monthly");
  const maxSaving = Math.max(...PLAN_ORDER.map((t) => yearlySaving(t)));
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const shopify = useAppBridge();
  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state === "idle" && d?.error) shopify.toast.show(d.error, { isError: true, duration: 10000 });
  }, [fetcher.state, fetcher.data, shopify]);
  return (
    <Page>
      <TitleBar title="Plans" />
      <Layout>
        <Layout.Section>
          <InlineStack align="center" gap="300" blockAlign="center">
            <ButtonGroup variant="segmented">
              <Button pressed={cycle === "monthly"} onClick={() => setCycle("monthly")}>Monthly</Button>
              <Button pressed={cycle === "yearly"} onClick={() => setCycle("yearly")}>Yearly</Button>
            </ButtonGroup>
            {maxSaving > 0 && <Badge tone="success">{`Save up to ${maxSaving}% yearly`}</Badge>}
          </InlineStack>
        </Layout.Section>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            {PLAN_ORDER.map((tier) => {
              const offer = offerFor(tier, cycle);
              const key = offer?.key ?? FREE_PLAN;
              const current = tier === FREE_PLAN ? active === FREE_PLAN : activeKey === key;
              // Same tier, other billing cycle: switching, not starting a trial.
              const switching = !current && tier !== FREE_PLAN && active === tier;
              const saving = cycle === "yearly" ? yearlySaving(tier) : 0;
              return (
                <Card key={tier}>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingLg">{tier}</Text>
                        {current && <Badge tone="success">Active</Badge>}
                      </InlineStack>
                      <Text as="span" tone="subdued">{TAGLINES[tier]}</Text>
                    </BlockStack>
                    <Box>
                      <Text as="span" variant="heading2xl">{offer ? offer.price : "$0"}</Text>
                      <Text as="span" tone="subdued">{offer ? (offer.cycle === "yearly" ? " / year" : " / month") : ""}</Text>
                      {offer?.cycle === "yearly" && (
                        <Text as="p" variant="bodySm" tone="success">
                          {`$${(offer.amount / 12).toFixed(2)}/month billed yearly${saving > 0 ? ` · save ${saving}%` : ""}`}
                        </Text>
                      )}
                      {offer && active === FREE_PLAN && <Text as="p" variant="bodySm" tone="subdued">{offer.trialDays + trialBonus}-day free trial</Text>}
                    </Box>
                    <List>
                      {PLAN_FEATURES[tier].map((f) => <List.Item key={f}>{f}</List.Item>)}
                    </List>
                    <Button
                      variant={current ? "secondary" : "primary"}
                      disabled={current || busy}
                      loading={busy && fetcher.formData?.get("plan") === key}
                      onClick={() => fetcher.submit({ plan: key }, { method: "POST" })}
                    >
                      {current
                        ? "Current plan"
                        : tier === FREE_PLAN
                          ? "Downgrade"
                          : switching
                            ? `Switch to ${cycle}`
                            : active !== FREE_PLAN
                              ? `Change to ${tier}`
                              : "Start free trial"}
                    </Button>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Text as="p" tone="subdued">
            {isTest
              ? "Test mode: charges are created as test charges while the app is in development."
              : "Billed through Shopify on your regular invoice. Cancel anytime from this page."}
          </Text>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
