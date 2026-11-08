import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  ProgressBar,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActivePlan } from "../models/billing.server";
import { getScanState, runScanStep, startScan } from "../models/scan.server";
import { getUsage } from "../models/usage.server";
import { ISSUES, parseIssues, scoreTone, type IssueCode } from "../lib/audit";
import { RESOURCES, RESOURCE_LABEL } from "../lib/templates";
import { can, formatLimit, limit, FEATURE_MIN_PLAN } from "../lib/plans";

const FIX_LINK: Partial<Record<IssueCode, string>> = {
  title_missing: "/app/meta?issue=title_missing",
  title_long: "/app/meta?issue=title_long",
  title_short: "/app/meta?issue=title_short",
  desc_missing: "/app/meta?issue=desc_missing",
  desc_long: "/app/meta?issue=desc_long",
  desc_short: "/app/meta?issue=desc_short",
  dup_title: "/app/meta?issue=dup_title",
  dup_desc: "/app/meta?issue=dup_desc",
  alt_missing: "/app/alt",
  broken_links: "/app/redirects#broken",
  thin_content: "/app/meta?issue=thin_content",
  handle_long: "/app/meta?issue=handle_long",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getActivePlan(admin);
  const [scan, items, usage, compressed] = await Promise.all([
    getScanState(shop),
    prisma.auditItem.findMany({ where: { shop }, select: { resource: true, issues: true, score: true } }),
    getUsage(shop),
    prisma.compressedImage.aggregate({ where: { shop, status: "compressed" }, _sum: { originalBytes: true, newBytes: true }, _count: true }),
  ]);

  const issueCounts: Partial<Record<IssueCode, number>> = {};
  const perResource: Record<string, { count: number; score: number }> = {};
  for (const it of items) {
    for (const code of parseIssues(it.issues)) issueCounts[code] = (issueCounts[code] ?? 0) + 1;
    const r = (perResource[it.resource] ??= { count: 0, score: 0 });
    r.count += 1;
    r.score += it.score;
  }
  const score = items.length ? Math.round(items.reduce((s, i) => s + i.score, 0) / items.length) : null;

  return {
    plan,
    scan,
    score,
    total: items.length,
    perResource: RESOURCES.map((r) => ({
      resource: r,
      label: RESOURCE_LABEL[r],
      count: perResource[r]?.count ?? 0,
      score: perResource[r]?.count ? Math.round(perResource[r].score / perResource[r].count) : null,
    })),
    issues: (Object.keys(issueCounts) as IssueCode[])
      .map((code) => ({ code, count: issueCounts[code]!, ...ISSUES[code], link: FIX_LINK[code] ?? "/app/meta" }))
      .sort((a, b) => b.weight * b.count - a.weight * a.count),
    usage,
    limits: {
      metaEdits: limit(plan, "metaEdits"),
      altEdits: limit(plan, "altEdits"),
      compressions: limit(plan, "compressions"),
      auditItems: limit(plan, "auditItems"),
    },
    allResources: can(plan, "allResources"),
    saved: {
      count: compressed._count,
      bytes: (compressed._sum.originalBytes ?? 0) - (compressed._sum.newBytes ?? 0),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getActivePlan(admin);
  const form = await request.formData();
  const state =
    form.get("intent") === "start"
      ? await startScan(session.shop, plan).then(() => runScanStep(session.shop, admin, plan))
      : await runScanStep(session.shop, admin, plan);
  return { scan: state };
};

const PHASE_LABEL: Record<string, string> = {
  product: "Scanning products",
  collection: "Scanning collections",
  page: "Scanning pages",
  article: "Scanning blog posts",
  finalize: "Checking duplicates and links",
  done: "Done",
};

function mb(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const scan = fetcher.data?.scan ?? data.scan;
  const running = scan?.status === "running";
  const prev = useRef(scan?.status);

  // Keep stepping the scan while it runs; refresh the page when it finishes.
  useEffect(() => {
    if (running && fetcher.state === "idle") fetcher.submit({ intent: "step" }, { method: "POST" });
    if (prev.current === "running" && scan?.status !== "running") revalidator.revalidate();
    prev.current = scan?.status;
  }, [running, fetcher.state, scan?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => fetcher.submit({ intent: "start" }, { method: "POST" });

  return (
    <Page>
      <TitleBar title="Easy SEO & Meta" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg">SEO score</Text>
                  <Text as="p" tone="subdued">
                    {scan?.finishedAt
                      ? `Last audit ${new Date(scan.finishedAt).toLocaleString()} · ${data.total.toLocaleString()} pages checked`
                      : "Run your first audit to see what's holding your store back in search."}
                  </Text>
                </BlockStack>
                <Button variant="primary" onClick={start} loading={running} disabled={running}>
                  {scan?.finishedAt ? "Run audit again" : "Run SEO audit"}
                </Button>
              </InlineStack>
              {running && (
                <BlockStack gap="200">
                  <Text as="p">{PHASE_LABEL[scan!.phase] ?? "Scanning"} — {scan!.scanned.toLocaleString()} checked</Text>
                  <ProgressBar progress={Math.min(95, scan!.cap > 0 ? (scan!.scanned / scan!.cap) * 100 : (["product", "collection", "page", "article", "finalize"].indexOf(scan!.phase) + 1) * 19)} />
                </BlockStack>
              )}
              {scan?.status === "failed" && <Banner tone="critical">The audit stopped: {scan.error}. Run it again to retry.</Banner>}
              {data.score !== null && (
                <InlineStack gap="400" blockAlign="center">
                  <Text as="p" variant="heading3xl">{data.score}</Text>
                  <Badge tone={scoreTone(data.score)} size="large">
                    {data.score >= 80 ? "Good" : data.score >= 50 ? "Needs work" : "Poor"}
                  </Badge>
                </InlineStack>
              )}
              {data.limits.auditItems >= 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  The Free plan audits your first {data.limits.auditItems} products.{" "}
                  <Link to="/app/plans">Upgrade</Link> to audit every product, collection, page and blog post.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {data.total > 0 && (
          <Layout.Section>
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
              {data.perResource.map((r) => (
                <Card key={r.resource}>
                  <BlockStack gap="100">
                    <Text as="span" tone="subdued">{r.label}</Text>
                    <Text as="p" variant="headingXl">{r.score ?? "—"}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {r.count ? `${r.count} checked` : r.resource !== "product" && !data.allResources ? `${FEATURE_MIN_PLAN.allResources} plan` : "none"}
                    </Text>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </Layout.Section>
        )}

        {data.issues.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Issues to fix</Text>
                {data.issues.map((issue, i) => (
                  <BlockStack key={issue.code} gap="200">
                    {i > 0 && <Divider />}
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={issue.severity === "critical" ? "critical" : "warning"}>{String(issue.count)}</Badge>
                          <Text as="span" fontWeight="semibold">{issue.label}</Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">{issue.fix}</Text>
                      </BlockStack>
                      <Button url={issue.link}>Fix</Button>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">This month</Text>
                <Badge>{`${data.plan} plan`}</Badge>
              </InlineStack>
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                {[
                  { label: "Template meta edits", used: data.usage.metaEdits, cap: data.limits.metaEdits },
                  { label: "Alt texts written", used: data.usage.altEdits, cap: data.limits.altEdits },
                  { label: "Images compressed", used: data.usage.compressions, cap: data.limits.compressions },
                ].map((m) => (
                  <Box key={m.label}>
                    <Text as="p" tone="subdued">{m.label}</Text>
                    <Text as="p" variant="headingMd">
                      {m.used.toLocaleString()} / {formatLimit(m.cap)}
                    </Text>
                  </Box>
                ))}
              </InlineGrid>
              {data.saved.count > 0 && (
                <Text as="p" tone="subdued">
                  {data.saved.count} images compressed so far, {mb(data.saved.bytes)} smaller.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
