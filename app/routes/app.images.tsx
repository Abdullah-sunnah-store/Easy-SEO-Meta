import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Badge,
  Banner,
  ProgressBar,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActivePlan } from "../models/billing.server";
import { addUsage, remaining } from "../models/usage.server";
import { compressBatch, restoreImage } from "../models/images.server";
import { MIN_BYTES } from "../lib/images";
import { AdminError } from "../models/admin.server";
import { formatLimit, limit } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getActivePlan(admin);
  const handled = await prisma.compressedImage.findMany({
    where: { shop, status: { in: ["compressed", "skipped", "restored", "failed"] } },
    select: { mediaId: true },
  });
  const notIn = handled.map((h) => h.mediaId);
  const failed = await prisma.compressedImage.count({ where: { shop, status: "failed" } });
  const [eligible, totals, recent, saved, left, settings, scanned] = await Promise.all([
    prisma.auditImage.count({ where: { shop, bytes: { gte: MIN_BYTES }, mediaId: { notIn } } }),
    prisma.auditImage.aggregate({ where: { shop, bytes: { gte: MIN_BYTES }, mediaId: { notIn } }, _sum: { bytes: true } }),
    prisma.compressedImage.findMany({ where: { shop }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.compressedImage.aggregate({ where: { shop, status: "compressed" }, _sum: { originalBytes: true, newBytes: true }, _count: true }),
    remaining(shop, plan, "compressions"),
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.auditImage.count({ where: { shop } }),
  ]);
  return {
    eligible,
    failed,
    eligibleBytes: totals._sum.bytes ?? 0,
    scanned,
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    saved: { count: saved._count, bytes: (saved._sum.originalBytes ?? 0) - (saved._sum.newBytes ?? 0) },
    left: Number.isFinite(left) ? left : -1,
    monthlyCap: limit(plan, "compressions"),
    maxEdge: settings?.compressMaxEdge ?? 2048,
    quality: settings?.compressQuality ?? 80,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "compress") {
      const plan = await getActivePlan(admin);
      const allowance = await remaining(shop, plan, "compressions");
      if (allowance <= 0) return { ok: false, error: "This month's compressions are used up. Upgrade for more." };
      const result = await compressBatch(admin, shop, Number.isFinite(allowance) ? allowance : 100_000);
      await addUsage(shop, "compressions", result.compressed);
      return { ok: true, batch: { ...result, limited: Number.isFinite(allowance) && result.compressed >= allowance } };
    }
    if (intent === "retryFailed") {
      await prisma.compressedImage.deleteMany({ where: { shop, status: "failed" } });
      return { ok: true, cleared: true };
    }
    if (intent === "restore") {
      await restoreImage(admin, shop, String(form.get("mediaId")));
      return { ok: true, restored: true };
    }
  } catch (error) {
    console.error("Easy SEO images:", error);
    return { ok: false, error: error instanceof AdminError ? error.message : "Something went wrong. Try again." };
  }
  return { ok: false, error: "Unknown action." };
};

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const STATUS_TONE: Record<string, any> = { compressed: "success", skipped: undefined, failed: "critical", restored: "info" };

export default function ImagesPage() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const runner = useFetcher<typeof action>();
  const restorer = useFetcher<typeof action>();
  const [run, setRun] = useState<{ compressed: number; skipped: number; failed: number } | null>(null);

  useEffect(() => {
    const d = runner.data as any;
    if (runner.state === "idle" && d?.cleared) {
      revalidator.revalidate();
      return;
    }
    if (!run || runner.state !== "idle" || !d) return;
    if (d.error) {
      shopify.toast.show(d.error, { isError: true });
      setRun(null);
      revalidator.revalidate();
      return;
    }
    const next = {
      compressed: run.compressed + d.batch.compressed,
      skipped: run.skipped + d.batch.skipped,
      failed: run.failed + d.batch.failed,
    };
    if (d.batch.done) {
      shopify.toast.show(d.batch.limited ? `Compressed ${next.compressed} — monthly limit reached` : `Done: ${next.compressed} compressed, ${next.skipped} already optimised`);
      setRun(null);
      revalidator.revalidate();
      return;
    }
    setRun(next);
    revalidator.revalidate();
    runner.submit({ intent: "compress" }, { method: "POST" });
  }, [runner.state, runner.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = restorer.data as any;
    if (restorer.state !== "idle" || !d) return;
    shopify.toast.show(d.restored ? "Original image restored" : d.error, { isError: !d.restored });
    if (d.restored) revalidator.revalidate();
  }, [restorer.state, restorer.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    setRun({ compressed: 0, skipped: 0, failed: 0 });
    runner.submit({ intent: "compress" }, { method: "POST" });
  };
  const done = run ? run.compressed + run.skipped + run.failed : 0;

  return (
    <Page>
      <TitleBar title="Image compression" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                <BlockStack gap="050">
                  <Text as="span" tone="subdued">Large images to compress</Text>
                  <Text as="p" variant="headingXl">{data.eligible}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{size(data.eligibleBytes)} in total</Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" tone="subdued">Compressed so far</Text>
                  <Text as="p" variant="headingXl">{data.saved.count}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{size(data.saved.bytes)} saved</Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" tone="subdued">Left this month</Text>
                  <Text as="p" variant="headingXl">{data.left < 0 ? "∞" : data.left}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">of {formatLimit(data.monthlyCap)}</Text>
                </BlockStack>
              </InlineGrid>
              <Text as="p" tone="subdued">
                Images over {Math.round(MIN_BYTES / 1024)} KB are resized to at most {data.maxEdge}px and re-encoded at quality {data.quality}{" "}
                (<Link to="/app/settings">change</Link>). Each original is first saved to <b>Content → Files</b> as a backup, and you can restore it here at any time.
                Product image URLs, order and variant images stay the same.
              </Text>
              {run && (
                <BlockStack gap="100">
                  <Text as="p">Compressing… {run.compressed} compressed, {run.skipped} already optimised{run.failed ? `, ${run.failed} failed` : ""}</Text>
                  <ProgressBar progress={Math.min(95, (done / Math.max(1, data.eligible + done)) * 100)} />
                </BlockStack>
              )}
              {data.scanned === 0 && <Banner tone="info">Run the SEO audit from the dashboard first — it finds your product images.</Banner>}
              <InlineStack gap="200">
                {data.failed > 0 && !run && (
                  <Button onClick={() => runner.submit({ intent: "retryFailed" }, { method: "POST" })}>
                    {`Retry ${data.failed} failed`}
                  </Button>
                )}
                <Button variant="primary" onClick={start} loading={!!run} disabled={!!run || data.eligible === 0 || data.left === 0}>
                  {`Compress ${data.eligible} images`}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            {data.recent.length === 0 ? (
              <EmptyState heading="No images compressed yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Compressed images and their backups will be listed here.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "image", plural: "images" }}
                itemCount={data.recent.length}
                selectable={false}
                headings={[{ title: "Product" }, { title: "Before" }, { title: "After" }, { title: "Status" }, { title: "" }]}
              >
                {data.recent.map((r, i) => (
                  <IndexTable.Row id={r.id} key={r.id} position={i}>
                    <IndexTable.Cell>{r.productTitle || "Product image"}</IndexTable.Cell>
                    <IndexTable.Cell>{r.originalBytes ? size(r.originalBytes) : "—"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {r.status === "compressed" ? `${size(r.newBytes)} (−${Math.round((1 - r.newBytes / Math.max(1, r.originalBytes)) * 100)}%)` : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status === "skipped" ? "Already optimised" : r.status.charAt(0).toUpperCase() + r.status.slice(1)}</Badge>
                        {r.message && r.status === "failed" && <Text as="span" variant="bodySm" tone="critical">{r.message}</Text>}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {r.status === "compressed" && r.backupFileId && (
                        <Button size="slim" onClick={() => restorer.submit({ intent: "restore", mediaId: r.mediaId }, { method: "POST" })} loading={restorer.state !== "idle" && restorer.formData?.get("mediaId") === r.mediaId}>
                          Restore original
                        </Button>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
