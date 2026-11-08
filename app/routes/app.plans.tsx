import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineGrid, InlineStack, Text, Button, Badge, List, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { BILLING_PLANS, FREE_PLAN, PLAN_FEATURES, PLAN_ORDER, billingPlan, type PlanName } from "../lib/plans";
import { BILLING_TEST, forgetCachedPlan, getActiveSubscription } from "../models/billing.server";

const TAGLINES: Record<PlanName, string> = {
  Free: "Get the basics right",
  Basic: "For growing stores",
  Advanced: "For catalogues that change a lot",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  forgetCachedPlan(session.shop);
  const { plan, key } = await getActiveSubscription(admin);
  return { active: plan, activeKey: key, isTest: BILLING_TEST };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  forgetCachedPlan(session.shop);
  const key = String((await request.formData()).get("plan"));
  if (key === FREE_PLAN) {
    const { appSubscriptions } = await billing.check({ plans: BILLING_PLANS.map((p) => p.key) as never[], isTest: BILLING_TEST });
    for (const sub of appSubscriptions ?? []) {
      await billing.cancel({ subscriptionId: sub.id, isTest: BILLING_TEST, prorate: true });
    }
    return redirect("/app/plans");
  }
  if (!billingPlan(key)) return { error: "Unknown plan." };
  await billing.request({ plan: key as never, isTest: BILLING_TEST });
  return null;
};

export default function PlansPage() {
  const { active, activeKey, isTest } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <Page>
      <TitleBar title="Plans" />
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            {PLAN_ORDER.map((tier) => {
              const offer = BILLING_PLANS.find((p) => p.tier === tier);
              const key = offer?.key ?? FREE_PLAN;
              const current = tier === FREE_PLAN ? active === FREE_PLAN : activeKey === key;
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
                      <Text as="span" tone="subdued">{offer ? " / month" : ""}</Text>
                      {offer && <Text as="p" variant="bodySm" tone="subdued">{offer.trialDays}-day free trial</Text>}
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
                      {current ? "Current plan" : tier === FREE_PLAN ? "Downgrade" : "Start free trial"}
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
