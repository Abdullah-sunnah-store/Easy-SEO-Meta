import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Badge, Box, Divider, List, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { gql } from "../models/admin.server";
import { syncSchemaPlan } from "../models/schema.server";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";

// Theme app embed handle = the block's file name in extensions/easy-seo-schema/blocks.
const EMBED_HANDLE = "schema";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await syncSchemaPlan(admin);
  let sampleUrl = "";
  let storeUrl = "";
  try {
    const data = await gql(admin, `#graphql
      query SeoSchemaSample {
        shop { primaryDomain { url } }
        products(first: 1, query: "status:active", sortKey: UPDATED_AT, reverse: true) { nodes { onlineStoreUrl handle } }
      }`);
    storeUrl = String(data?.shop?.primaryDomain?.url ?? "").replace(/\/+$/, "");
    const p = data?.products?.nodes?.[0];
    sampleUrl = p?.onlineStoreUrl || (p?.handle && storeUrl ? `${storeUrl}/products/${p.handle}` : storeUrl);
  } catch (error) {
    console.warn("Easy SEO schema: sample product lookup failed:", (error as Error)?.message || error);
  }
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() || "";
  return {
    plan,
    paid: can(plan, "schemaPlus"),
    minPlan: FEATURE_MIN_PLAN.schemaPlus,
    editorUrl: `https://${session.shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`,
    testUrl: sampleUrl ? `https://search.google.com/test/rich-results?url=${encodeURIComponent(sampleUrl)}` : "https://search.google.com/test/rich-results",
    sampleUrl,
  };
};

const FREE_TYPES = [
  { name: "Product", where: "Product pages", what: "Price, stock, brand, SKU, barcode and star ratings from your reviews app" },
  { name: "Breadcrumbs", where: "Products, collections, blog posts, pages", what: "Shows the page path instead of a long URL in Google" },
  { name: "Organization", where: "Home page", what: "Your store name, logo and social profiles" },
  { name: "Site search", where: "Home page", what: "Lets Google show a search box for your store" },
];
const PAID_TYPES = [
  { name: "Blog article", where: "Blog posts", what: "Headline, image, author and dates for article results" },
  { name: "Collection", where: "Collection pages", what: "The list of products on each collection page" },
];

export default function SchemaPage() {
  const data = useLoaderData<typeof loader>();

  const row = (t: { name: string; where: string; what: string }, locked: boolean) => (
    <BlockStack key={t.name} gap="050">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span" fontWeight="semibold">{t.name}</Text>
        {locked ? <Badge tone="attention">{`${data.minPlan} plan`}</Badge> : <Badge tone="success">Included</Badge>}
      </InlineStack>
      <Text as="span" variant="bodySm" tone="subdued">{`${t.where} · ${t.what}`}</Text>
    </BlockStack>
  );

  return (
    <Page>
      <TitleBar title="Rich results (schema)" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">Get rich results in Google</Text>
                <Text as="p" tone="subdued">
                  Structured data (JSON-LD schema) tells Google exactly what is on each page, so it can show price, stock and
                  star ratings under your listing. It is added by a theme app embed: no code, and it is removed cleanly if you
                  turn it off.
                </Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">1. Turn on the schema embed</Text>
                    <Text as="p" tone="subdued">Opens your theme editor with Easy SEO schema switched on. Click Save there.</Text>
                  </BlockStack>
                  <Button variant="primary" url={data.editorUrl} target="_top">Turn on in theme</Button>
                </InlineStack>
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">2. Add your logo and social links</Text>
                    <Text as="p" tone="subdued">In the same embed settings. Google uses them for your brand panel.</Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">3. Test a product page</Text>
                    <Text as="p" tone="subdued">
                      {data.sampleUrl ? `Google's Rich Results Test checks ${data.sampleUrl}` : "Paste any product URL into Google's Rich Results Test."}
                    </Text>
                  </BlockStack>
                  <Button url={data.testUrl} target="_blank">Test with Google</Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">What gets added</Text>
              {FREE_TYPES.map((t) => row(t, false))}
              {PAID_TYPES.map((t) => row(t, !data.paid))}
              {!data.paid && (
                <Box paddingBlockStart="100">
                  <Text as="p" variant="bodySm">
                    <Link to="/app/plans">Upgrade to {data.minPlan}</Link> to add blog article and collection schema too.
                  </Text>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info" title="Good to know">
            <List>
              <List.Item>Star ratings appear when your reviews app saves ratings to Shopify's standard product rating fields (most do, including Easy Reviews &amp; UGC and Judge.me).</List.Item>
              <List.Item>Some themes already add basic product schema. If Google's test shows two Product items, untick "Product schema" in the embed or remove the theme's own.</List.Item>
              <List.Item>Google decides when to show rich results; it can take a few days after your pages are crawled again.</List.Item>
            </List>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
