import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Thumbnail,
  ProgressBar,
  EmptyState,
  Box,
  ChoiceList,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActivePlan } from "../models/billing.server";
import { addUsage, remaining } from "../models/usage.server";
import { applyAltBatch, writeAlt } from "../models/meta.server";
import { refreshItem } from "../models/scan.server";
import { AdminError } from "../models/admin.server";
import { formatLimit, limit } from "../lib/plans";

const PAGE_SIZE = 40;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const show = url.searchParams.get("show") === "all" ? "all" : "missing";
  const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10) || 0);
  const where: any = { shop, ...(show === "missing" ? { alt: "" } : {}) };
  const plan = await getActivePlan(admin);
  const [images, total, missing, all, left] = await Promise.all([
    prisma.auditImage.findMany({ where, orderBy: [{ productTitle: "asc" }, { position: "asc" }], skip: page * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditImage.count({ where }),
    prisma.auditImage.count({ where: { shop, alt: "" } }),
    prisma.auditImage.count({ where: { shop } }),
    remaining(shop, plan, "altEdits"),
  ]);
  return {
    show,
    page,
    total,
    missing,
    all,
    images: images.map((i) => ({ id: i.id, mediaId: i.mediaId, productId: i.productId, productTitle: i.productTitle, url: i.url, alt: i.alt, position: i.position })),
    left: Number.isFinite(left) ? left : -1,
    monthlyCap: limit(plan, "altEdits"),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "save") {
      const mediaId = String(form.get("mediaId"));
      const alt = String(form.get("alt") ?? "");
      const img = await prisma.auditImage.findUnique({ where: { shop_mediaId: { shop, mediaId } } });
      if (!img) return { ok: false, error: "Image not found — run the audit again." };
      await writeAlt(admin, [{ mediaId, alt }]);
      await prisma.auditImage.update({ where: { id: img.id }, data: { alt: alt.trim() } });
      await refreshItem(shop, img.productId, { missingAlt: await prisma.auditImage.count({ where: { shop, productId: img.productId, alt: "" } }) });
      return { ok: true, saved: true };
    }
    if (intent === "bulk") {
      const plan = await getActivePlan(admin);
      const allowance = await remaining(shop, plan, "altEdits");
      const result = await applyAltBatch({
        admin,
        shop,
        scope: form.get("scope") === "all" ? "all" : "missing",
        afterId: String(form.get("afterId") || ""),
        allowance: Number.isFinite(allowance) ? allowance : 10_000,
      });
      await addUsage(shop, "altEdits", result.applied);
      return { ok: true, bulk: result };
    }
  } catch (error) {
    console.error("Easy SEO alt:", error);
    return { ok: false, error: error instanceof AdminError ? `Shopify said: ${error.message}` : "Saving failed. Try again." };
  }
  return { ok: false, error: "Unknown action." };
};

function AltRow({ image, onSave, saving }: { image: any; onSave: (alt: string) => void; saving: boolean }) {
  const [value, setValue] = useState(image.alt);
  useEffect(() => setValue(image.alt), [image.alt]);
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Thumbnail source={image.url + (image.url.includes("?") ? "&" : "?") + "width=120"} alt={image.alt} size="medium" />
      <div style={{ flex: 1 }}>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">{image.productTitle} · image {image.position}</Text>
          <TextField label="Alt text" labelHidden autoComplete="off" value={value} onChange={setValue} placeholder="Describe the image" maxLength={512} />
        </BlockStack>
      </div>
      <Button onClick={() => onSave(value)} loading={saving} disabled={value === image.alt}>Save</Button>
    </InlineStack>
  );
}

export default function AltPage() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const saver = useFetcher<typeof action>();
  const bulk = useFetcher<typeof action>();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [run, setRun] = useState<{ scope: "missing" | "all"; applied: number } | null>(null);

  useEffect(() => {
    const d = saver.data as any;
    if (saver.state !== "idle" || !d) return;
    if (d.saved) shopify.toast.show("Alt text saved");
    if (d.error) shopify.toast.show(d.error, { isError: true });
    setSavingId(null);
  }, [saver.state, saver.data, shopify]);

  useEffect(() => {
    const d = bulk.data as any;
    if (!run || bulk.state !== "idle" || !d) return;
    if (d.error) {
      shopify.toast.show(d.error, { isError: true });
      setRun(null);
      return;
    }
    const applied = run.applied + (d.bulk?.applied ?? 0);
    if (d.bulk?.done) {
      shopify.toast.show(d.bulk.limited ? `Wrote ${applied} — monthly limit reached` : `Alt text written for ${applied} images`);
      setRun(null);
      revalidator.revalidate();
      return;
    }
    setRun({ ...run, applied });
    bulk.submit({ intent: "bulk", scope: run.scope, afterId: d.bulk.lastId }, { method: "POST" });
  }, [bulk.state, bulk.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (scope: "missing" | "all") => {
    setRun({ scope, applied: 0 });
    bulk.submit({ intent: "bulk", scope, afterId: "" }, { method: "POST" });
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  return (
    <Page>
      <TitleBar title="Image alt text" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">{data.missing} of {data.all} product images have no alt text</Text>
                  <Text as="p" tone="subdued">
                    Alt text is how search engines (and screen readers) understand images. Template:{" "}
                    <Link to="/app/settings">edit in Settings</Link>.
                  </Text>
                </BlockStack>
                <Text as="span" tone="subdued">
                  {data.left < 0 ? "Unlimited" : `${data.left} of ${formatLimit(data.monthlyCap)} left this month`}
                </Text>
              </InlineStack>
              {run && (
                <BlockStack gap="100">
                  <Text as="p">Writing alt text… {run.applied} done</Text>
                  <ProgressBar progress={Math.min(95, (run.applied / Math.max(1, run.scope === "missing" ? data.missing : data.all)) * 100)} />
                </BlockStack>
              )}
              <InlineStack gap="200">
                <Button variant="primary" disabled={!!run || data.missing === 0 || data.left === 0} onClick={() => start("missing")}>
                  {`Fill missing alt text (${data.missing})`}
                </Button>
                <Button disabled={!!run || data.all === 0 || data.left === 0} onClick={() => start("all")}>Rewrite all from template</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <ChoiceList
                title="Show"
                choices={[{ label: "Missing alt text", value: "missing" }, { label: "All images", value: "all" }]}
                selected={[data.show]}
                onChange={(v) => setParam("show", v[0])}
              />
              <Divider />
              {data.images.length === 0 ? (
                <EmptyState heading={data.all === 0 ? "No images scanned yet" : "Every image has alt text"} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>{data.all === 0 ? "Run the SEO audit from the dashboard first." : "Nice work."}</p>
                </EmptyState>
              ) : (
                data.images.map((img) => (
                  <AltRow
                    key={img.id}
                    image={img}
                    saving={savingId === img.mediaId && saver.state !== "idle"}
                    onSave={(alt) => {
                      setSavingId(img.mediaId);
                      saver.submit({ intent: "save", mediaId: img.mediaId, alt }, { method: "POST" });
                    }}
                  />
                ))
              )}
              {data.total > PAGE_SIZE && (
                <Box paddingBlockStart="200">
                  <InlineStack align="center" gap="300">
                    <Button disabled={data.page === 0} onClick={() => setParam("page", String(data.page - 1))}>Previous</Button>
                    <Text as="span">Page {data.page + 1} of {Math.ceil(data.total / PAGE_SIZE)}</Text>
                    <Button disabled={(data.page + 1) * PAGE_SIZE >= data.total} onClick={() => setParam("page", String(data.page + 1))}>Next</Button>
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
