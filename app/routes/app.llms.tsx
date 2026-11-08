import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Badge, TextField, Box, Banner } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSettings, updateSettings } from "../models/settings.server";
import { regenerateLlms, setLlmsEnabled } from "../models/llms.server";
import { LLMS_PROXY_PATH } from "../lib/llms";
import { gql, AdminError } from "../models/admin.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const data = await gql(admin, `#graphql
    query SeoDomain { shop { primaryDomain { url } } }`);
  return {
    enabled: settings.llmsEnabled,
    intro: settings.llmsIntro,
    text: settings.llmsText,
    generatedAt: settings.llmsGeneratedAt?.toISOString() ?? null,
    storeUrl: String(data?.shop?.primaryDomain?.url ?? "").replace(/\/+$/, ""),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "toggle") {
      await setLlmsEnabled(admin, shop, form.get("enabled") === "true");
      return { ok: true, message: form.get("enabled") === "true" ? "llms.txt is live" : "llms.txt turned off" };
    }
    if (intent === "save") {
      await updateSettings(shop, { llmsIntro: String(form.get("intro") || "").slice(0, 600) });
      await regenerateLlms(admin, shop);
      return { ok: true, message: "llms.txt regenerated" };
    }
  } catch (error) {
    console.error("Easy SEO llms:", error);
    return { ok: false, error: error instanceof AdminError ? `Shopify said: ${error.message}` : "Something went wrong." };
  }
  return { ok: false, error: "Unknown action." };
};

export default function LlmsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [intro, setIntro] = useState(data.intro);

  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state !== "idle" || !d) return;
    shopify.toast.show(d.message ?? d.error, { isError: !d.ok });
    if (d.ok) revalidator.revalidate();
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = fetcher.state !== "idle";
  return (
    <Page>
      <TitleBar title="llms.txt" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">llms.txt for AI search</Text>
                  <Badge tone={data.enabled ? "success" : undefined}>{data.enabled ? "Live" : "Off"}</Badge>
                </InlineStack>
                <Button
                  variant={data.enabled ? "secondary" : "primary"}
                  loading={busy && fetcher.formData?.get("intent") === "toggle"}
                  onClick={() => fetcher.submit({ intent: "toggle", enabled: String(!data.enabled) }, { method: "POST" })}
                >
                  {data.enabled ? "Turn off" : "Turn on"}
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                llms.txt is a plain-text summary of your store — collections, products, pages and policies — that AI assistants such as ChatGPT,
                Claude and Perplexity can read to understand and recommend your shop. Turning it on publishes it at{" "}
                <b>{data.storeUrl}/llms.txt</b> (a redirect to {LLMS_PROXY_PATH}). It refreshes itself daily.
              </Text>
              {data.enabled && data.storeUrl && (
                <InlineStack>
                  <Button url={`${data.storeUrl}/llms.txt`} target="_blank" variant="plain">Open your llms.txt</Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <TextField
                label="Store summary (optional)"
                autoComplete="off"
                multiline={3}
                maxLength={600}
                showCharacterCount
                value={intro}
                onChange={setIntro}
                helpText="One or two sentences on what you sell and who it's for. Empty = your store's meta description."
              />
              <InlineStack>
                <Button onClick={() => fetcher.submit({ intent: "save", intro }, { method: "POST" })} loading={busy && fetcher.formData?.get("intent") === "save"}>
                  Save and regenerate
                </Button>
              </InlineStack>
              {data.text ? (
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Preview{data.generatedAt ? ` · generated ${new Date(data.generatedAt).toLocaleString()}` : ""}
                  </Text>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 420, overflow: "auto" }}>{data.text}</pre>
                  </Box>
                </BlockStack>
              ) : (
                <Banner tone="info">Turn it on or press "Save and regenerate" to build it.</Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
