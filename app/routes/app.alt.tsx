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
import { applyAiAltBatch, applyAltBatch, shopName, writeAlt } from "../models/meta.server";
import { AiError, aiConfigured, generateAlt } from "../models/ai.server";
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
  const [images, total, missing, all, left, aiLeft] = await Promise.all([
    prisma.auditImage.findMany({ where, orderBy: [{ productTitle: "asc" }, { position: "asc" }], skip: page * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditImage.count({ where }),
    prisma.auditImage.count({ where: { shop, alt: "" } }),
    prisma.auditImage.count({ where: { shop } }),
    remaining(shop, plan, "altEdits"),
    remaining(shop, plan, "aiGenerations"),
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
    ai: { enabled: aiConfigured(), left: Number.isFinite(aiLeft) ? aiLeft : -1, cap: limit(plan, "aiGenerations") },
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
    if (intent === "ai") {
      const mediaId = String(form.get("mediaId"));
      const img = await prisma.auditImage.findUnique({ where: { shop_mediaId: { shop, mediaId } } });
      if (!img) return { ok: false, error: "Image not found — run the audit again." };
      const plan = await getActivePlan(admin);
      if ((await remaining(shop, plan, "aiGenerations")) <= 0) {
        return { ok: false, error: "You've used this month's AI writes. Upgrade for more, or write it by hand." };
      }
      const alt = await generateAlt({ imageUrl: img.url, productTitle: img.productTitle, store: await shopName(admin, shop) });
      await addUsage(shop, "aiGenerations", 1);
      return { ok: true, ai: { mediaId, alt } };
    }
    if (intent === "aibulk") {
      if (!aiConfigured()) return { ok: false, error: "AI writing isn't set up yet." };
      const plan = await getActivePlan(admin);
      const allowance = await remaining(shop, plan, "aiGenerations");
      const result = await applyAiAltBatch({
        admin,
        shop,
        afterId: String(form.get("afterId") || ""),
        allowance: Number.isFinite(allowance) ? allowance : 10_000,
      });
      await addUsage(shop, "aiGenerations", result.applied);
      return { ok: true, aibulk: result };
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
    if (error instanceof AiError) return { ok: false, error: error.message };
    console.error("Easy SEO alt:", error);
    return { ok: false, error: error instanceof AdminError ? `Shopify said: ${error.message}` : "Saving failed. Try again." };
  }
  return { ok: false, error: "Unknown action." };
};

function AltRow({
  image,
  onSave,
  saving,
  onAi,
  aiBusy,
  aiDisabled,
  aiDraft,
}: {
  image: any;
  onSave: (alt: string) => void;
  saving: boolean;
  onAi: () => void;
  aiBusy: boolean;
  aiDisabled: boolean;
  aiDraft?: string;
}) {
  const [value, setValue] = useState(image.alt);
  useEffect(() => setValue(image.alt), [image.alt]);
  useEffect(() => {
    if (aiDraft) setValue(aiDraft);
  }, [aiDraft]);
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Thumbnail source={image.url + (image.url.includes("?") ? "&" : "?") + "width=120"} alt={image.alt} size="medium" />
      <div style={{ flex: 1 }}>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">{image.productTitle} · image {image.position}</Text>
          <TextField label="Alt text" labelHidden autoComplete="off" value={value} onChange={setValue} placeholder="Describe the image" maxLength={512} />
        </BlockStack>
      </div>
      <Button onClick={onAi} loading={aiBusy} disabled={aiDisabled}>✨ AI</Button>
      <Button variant={value !== image.alt ? "primary" : undefined} onClick={() => onSave(value)} loading={saving} disabled={value === image.alt}>Save</Button>
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
  const writer = useFetcher<typeof action>();
  const aiBulk = useFetcher<typeof action>();
  const [aiDrafts, setAiDrafts] = useState<Record<string, string>>({});
  const [aiRun, setAiRun] = useState<{ applied: number; failed: number; total: number } | null>(null);
  const aiBusyId = writer.state !== "idle" ? String(writer.formData?.get("mediaId") ?? "") : "";
  const aiOff = !data.ai.enabled || data.ai.left === 0;

  // One image: the AI text goes into that row's field; Save writes it.
  useEffect(() => {
    const d = writer.data as any;
    if (writer.state !== "idle" || !d) return;
    if (d.error) shopify.toast.show(d.error, { isError: true });
    else if (d.ai) {
      setAiDrafts((cur) => ({ ...cur, [d.ai.mediaId]: d.ai.alt }));
      shopify.toast.show("AI alt text added — review it, then Save");
      revalidator.revalidate();
    }
  }, [writer.state, writer.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // All missing: batch after batch, saved straight to Shopify.
  useEffect(() => {
    const d = aiBulk.data as any;
    if (!aiRun || aiBulk.state !== "idle" || !d) return;
    if (d.error) {
      shopify.toast.show(d.error, { isError: true });
      setAiRun(null);
      revalidator.revalidate();
      return;
    }
    const r = d.aibulk;
    const applied = aiRun.applied + (r?.applied ?? 0);
    const failed = aiRun.failed + (r?.failed ?? 0);
    if (r?.done) {
      const skipped = failed ? `, ${failed} skipped` : "";
      if (r.stopped) shopify.toast.show(`AI wrote alt text for ${applied}${skipped}. ${r.stopped}`, { isError: true });
      else shopify.toast.show(r.limited ? `AI wrote ${applied}${skipped} — monthly AI limit reached` : `AI wrote alt text for ${applied} images${skipped}`);
      setAiRun(null);
      revalidator.revalidate();
      return;
    }
    setAiRun({ ...aiRun, applied, failed });
    aiBulk.submit({ intent: "aibulk", afterId: r.lastId }, { method: "POST" });
  }, [aiBulk.state, aiBulk.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const aiCount = data.ai.left < 0 ? data.missing : Math.min(data.missing, data.ai.left);
  const startAi = () => {
    setAiRun({ applied: 0, failed: 0, total: aiCount });
    aiBulk.submit({ intent: "aibulk", afterId: "" }, { method: "POST" });
  };

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
              {aiRun && (
                <BlockStack gap="100">
                  <Text as="p">✨ AI is looking at your images… {aiRun.applied} of {aiRun.total} done{aiRun.failed ? ` (${aiRun.failed} skipped)` : ""}. Keep this page open.</Text>
                  <ProgressBar tone="success" progress={Math.min(97, ((aiRun.applied + aiRun.failed) / Math.max(1, aiRun.total)) * 100)} />
                </BlockStack>
              )}
              {run && (
                <BlockStack gap="100">
                  <Text as="p">Writing alt text… {run.applied} done</Text>
                  <ProgressBar progress={Math.min(95, (run.applied / Math.max(1, run.scope === "missing" ? data.missing : data.all)) * 100)} />
                </BlockStack>
              )}
              <InlineStack gap="200">
                <Button variant="primary" tone="success" disabled={!!run || !!aiRun || aiOff || data.missing === 0} loading={!!aiRun} onClick={startAi}>
                  {`✨ Write all with AI (${aiCount})`}
                </Button>
                <Button disabled={!!run || !!aiRun || data.missing === 0 || data.left === 0} onClick={() => start("missing")}>
                  {`Fill missing from template (${data.missing})`}
                </Button>
                <Button disabled={!!run || !!aiRun || data.all === 0 || data.left === 0} onClick={() => start("all")}>Rewrite all from template</Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {!data.ai.enabled
                  ? "AI writing isn't set up on this app yet."
                  : `AI looks at each image and describes what's in it. ${data.ai.left < 0 ? "" : `${data.ai.left} of ${formatLimit(data.ai.cap)} AI writes left this month.`}`}
              </Text>
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
                    aiDraft={aiDrafts[img.mediaId]}
                    aiBusy={aiBusyId === img.mediaId}
                    aiDisabled={aiOff || writer.state !== "idle" || !!aiRun}
                    onAi={() => writer.submit({ intent: "ai", mediaId: img.mediaId }, { method: "POST" })}
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
