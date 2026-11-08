import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Checkbox,
  Select,
  Tag,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getActivePlan } from "../models/billing.server";
import { getSettings, updateSettings } from "../models/settings.server";
import { shopName } from "../models/meta.server";
import {
  DEFAULT_TEMPLATES,
  DESCRIPTION_MAX,
  RESOURCES,
  RESOURCE_LABEL,
  TITLE_MAX,
  TOKENS,
  parseTemplates,
  renderTemplate,
  type Resource,
  type Templates,
} from "../lib/templates";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getActivePlan(admin);
  const settings = await getSettings(session.shop);
  return {
    templates: parseTemplates(settings.templates),
    autoMetaNewProducts: settings.autoMetaNewProducts,
    compressMaxEdge: settings.compressMaxEdge,
    compressQuality: settings.compressQuality,
    canAutoMeta: can(plan, "autoMeta"),
    storeName: await shopName(admin, session.shop),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getActivePlan(admin);
  const form = await request.formData();
  let templates: Templates;
  try {
    templates = parseTemplates(String(form.get("templates") || "{}"));
  } catch {
    return { ok: false, error: "Templates could not be read." };
  }
  await updateSettings(session.shop, {
    templates: JSON.stringify(templates),
    autoMetaNewProducts: can(plan, "autoMeta") && form.get("autoMetaNewProducts") === "true",
    compressMaxEdge: Math.min(4096, Math.max(800, parseInt(String(form.get("compressMaxEdge") || "2048"), 10) || 2048)),
    compressQuality: Math.min(95, Math.max(50, parseInt(String(form.get("compressQuality") || "80"), 10) || 80)),
  });
  return { ok: true };
};

const SAMPLE: Record<Resource | "alt", Record<string, string>> = {
  product: { title: "Organic Cotton T-Shirt", vendor: "Acme", product_type: "T-Shirts", price: "24.00 USD", excerpt: "Soft, breathable organic cotton tee with a relaxed fit. Pre-shrunk and garment dyed for a lived-in feel from day one." },
  collection: { title: "Summer Sale", excerpt: "Light layers and beach essentials at up to 40% off while stock lasts." },
  page: { title: "About Us", excerpt: "We started in a garage in 2015 with one sewing machine and a simple idea: clothes that last." },
  article: { title: "How to Care for Linen", blog: "Journal", excerpt: "Linen gets softer with every wash — if you treat it right. Here's our five-step routine." },
  alt: { product_title: "Organic Cotton T-Shirt", vendor: "Acme", n: "2" },
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [templates, setTemplates] = useState<Templates>(data.templates);
  const [resource, setResource] = useState<Resource>("product");
  const [autoMeta, setAutoMeta] = useState(data.autoMetaNewProducts);
  const [maxEdge, setMaxEdge] = useState(String(data.compressMaxEdge));
  const [quality, setQuality] = useState(String(data.compressQuality));

  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state === "idle" && d) shopify.toast.show(d.ok ? "Settings saved" : d.error, { isError: !d.ok });
  }, [fetcher.state, fetcher.data, shopify]);

  const t = templates[resource];
  const ctx = { ...SAMPLE[resource], shop: data.storeName };
  const setField = (field: "title" | "description") => (v: string) =>
    setTemplates((prev) => ({ ...prev, [resource]: { ...prev[resource], [field]: v } }));

  const save = () =>
    fetcher.submit(
      {
        templates: JSON.stringify(templates),
        autoMetaNewProducts: String(autoMeta),
        compressMaxEdge: maxEdge,
        compressQuality: quality,
      },
      { method: "POST" },
    );

  return (
    <Page>
      <TitleBar title="Settings">
        <button variant="primary" onClick={save}>Save</button>
      </TitleBar>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Meta templates</Text>
                <Text as="p" tone="subdued">Used by "Fill missing" and bulk apply on the Meta tags page, and for new products.</Text>
              </BlockStack>
              <Select
                label="Template for"
                options={RESOURCES.map((r) => ({ label: RESOURCE_LABEL[r], value: r }))}
                value={resource}
                onChange={(v) => setResource(v as Resource)}
              />
              <InlineStack gap="100">
                {TOKENS[resource].map((tok) => (
                  <Tag key={tok.token} onClick={() => setField("title")(t.title + ` {{${tok.token}}}`)}>
                    {`{{${tok.token}}} ${tok.label}`}
                  </Tag>
                ))}
              </InlineStack>
              <TextField label="SEO title template" autoComplete="off" value={t.title} onChange={setField("title")} helpText="Click a token above to add it to the title." />
              <TextField label="Meta description template" autoComplete="off" multiline={2} value={t.description} onChange={setField("description")} />
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Preview with a sample {resource}</Text>
                  <p style={{ color: "#1a0dab", fontSize: 17, margin: 0 }}>{renderTemplate(t.title, ctx, TITLE_MAX)}</p>
                  <Text as="p" variant="bodySm">{renderTemplate(t.description, ctx, DESCRIPTION_MAX)}</Text>
                </BlockStack>
              </Box>
              <InlineStack>
                <Button variant="plain" onClick={() => setTemplates((prev) => ({ ...prev, [resource]: DEFAULT_TEMPLATES[resource] }))}>
                  Reset to default
                </Button>
              </InlineStack>
              <Divider />
              <TextField
                label="Image alt text template"
                autoComplete="off"
                value={templates.alt}
                onChange={(v) => setTemplates((prev) => ({ ...prev, alt: v }))}
                helpText={`Tokens: ${TOKENS.alt.map((x) => `{{${x.token}}}`).join(", ")}. Preview: "${renderTemplate(templates.alt, { ...SAMPLE.alt, shop: data.storeName }, 125)}"`}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">New products</Text>
              {!data.canAutoMeta && <UpgradeNotice required={FEATURE_MIN_PLAN.autoMeta} />}
              <Checkbox
                label="Automatically write the SEO title, meta description and image alt text for products added from now on"
                checked={autoMeta && data.canAutoMeta}
                onChange={setAutoMeta}
                disabled={!data.canAutoMeta}
                helpText="Uses the product templates above. Fields you fill in yourself are never overwritten."
              />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Image compression</Text>
              <Select
                label="Largest side"
                options={["1600", "2048", "2560", "3000", "4096"].map((v) => ({ label: `${v}px`, value: v }))}
                value={maxEdge}
                onChange={setMaxEdge}
                helpText="Bigger images are scaled down to this. 2048px is plenty for zoom on most themes."
              />
              <Select
                label="Quality"
                options={[
                  { label: "90 — highest", value: "90" },
                  { label: "85", value: "85" },
                  { label: "80 — recommended", value: "80" },
                  { label: "75", value: "75" },
                  { label: "70 — smallest", value: "70" },
                ]}
                value={quality}
                onChange={setQuality}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" onClick={save} loading={fetcher.state !== "idle"}>Save settings</Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
