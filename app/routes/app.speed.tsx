import { useEffect, useMemo, useState } from "react";
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
  Checkbox,
  TextField,
  ChoiceList,
  ProgressBar,
  Banner,
  Box,
  Divider,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActivePlan } from "../models/billing.server";
import { addUsage, remaining } from "../models/usage.server";
import { SpeedError, isPasswordProtected, parseOpportunities, resolveCustomUrl, runPageSpeed, speedTargets, type Strategy, type Target } from "../models/speed.server";
import { can, formatLimit, limit, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

// A PageSpeed run takes 10–40 s at Google.
export const config = { maxDuration: 60 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getActivePlan(admin);
  const allowed = can(plan, "speedTest");
  const [left, recent, { base, targets }] = await Promise.all([
    remaining(shop, plan, "speedTests"),
    prisma.speedTest.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 60 }),
    speedTargets(admin).catch(() => ({ base: "", targets: [] as Target[] })),
  ]);
  const passwordProtected = allowed ? await isPasswordProtected(base) : false;
  return {
    allowed,
    passwordProtected,
    left: Number.isFinite(left) ? left : -1,
    cap: limit(plan, "speedTests"),
    base,
    targets: targets.map((t) => ({ label: t.label, url: t.url })),
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), opportunities: parseOpportunities(r.opportunities) })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const plan = await getActivePlan(admin);
  if (!can(plan, "speedTest")) return { ok: false, error: `Speed tests are on the ${FEATURE_MIN_PLAN.speedTest} plan.` };
  if ((await remaining(shop, plan, "speedTests")) <= 0) return { ok: false, error: "You've used this month's speed tests." };

  const strategy: Strategy = form.get("strategy") === "desktop" ? "desktop" : "mobile";
  const label = String(form.get("label") || "").slice(0, 120);
  // Never test an arbitrary URL: only this shop's own storefront.
  const { base } = await speedTargets(admin);
  const url = resolveCustomUrl(String(form.get("url") || ""), base);
  if (!url) return { ok: false, error: "Only pages on your own store can be tested." };

  try {
    const r = await runPageSpeed(url, strategy);
    await prisma.speedTest.create({
      data: { shop, url, label, strategy, ...r, opportunities: JSON.stringify(r.opportunities) },
    });
    await addUsage(shop, "speedTests", 1);
    return { ok: true, score: r.score };
  } catch (error) {
    const message = error instanceof SpeedError ? error.message : "The speed test failed. Try again.";
    if (!(error instanceof SpeedError)) console.error("Easy SEO speed:", error);
    await prisma.speedTest.create({ data: { shop, url, label, strategy, error: message } });
    return { ok: false, error: message };
  }
};

// Google's Core Web Vitals thresholds: [good up to, poor above].
const LIMITS = {
  lcp: [2500, 4000],
  fcp: [1800, 3000],
  tbt: [200, 600],
  cls: [100, 250], // ×1000
  inp: [200, 500],
} as const;

type Tone = "success" | "warning" | "critical";
const toneFor = (v: number, [good, poor]: readonly [number, number]): Tone => (v <= good ? "success" : v <= poor ? "warning" : "critical");
const scoreTone = (s: number): Tone => (s >= 90 ? "success" : s >= 50 ? "warning" : "critical");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const cls = (x: number) => (x / 1000).toFixed(2);

function Metric({ label, value, tone, hint }: { label: string; value: string; tone: Tone; hint: string }) {
  return (
    <BlockStack gap="050">
      <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      <InlineStack gap="100" blockAlign="center">
        <Text as="span" variant="headingMd">{value}</Text>
        <Badge tone={tone}>{tone === "success" ? "Good" : tone === "warning" ? "Needs work" : "Poor"}</Badge>
      </InlineStack>
      <Text as="span" variant="bodySm" tone="subdued">{hint}</Text>
    </BlockStack>
  );
}

function ResultCard({ r }: { r: any }) {
  const when = new Date(r.createdAt).toLocaleString();
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">{r.label || r.url}</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {r.strategy === "mobile" ? "📱 Mobile" : "🖥 Desktop"} · {when} · <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
            </Text>
          </BlockStack>
          {r.error ? (
            <Badge tone="critical">Failed</Badge>
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 22,
                border: "6px solid",
                borderColor: r.score >= 90 ? "#29845a" : r.score >= 50 ? "#b28400" : "#c70a24",
              }}
              aria-label={`Performance score ${r.score}`}
            >
              {r.score}
            </div>
          )}
        </InlineStack>
        {r.error ? (
          <Banner tone="warning">{r.error}</Banner>
        ) : (
          <>
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
              <Metric label="Largest Contentful Paint" value={secs(r.lcpMs)} tone={toneFor(r.lcpMs, LIMITS.lcp)} hint="Main content visible" />
              <Metric label="First Contentful Paint" value={secs(r.fcpMs)} tone={toneFor(r.fcpMs, LIMITS.fcp)} hint="First thing on screen" />
              <Metric label="Total Blocking Time" value={`${r.tbtMs} ms`} tone={toneFor(r.tbtMs, LIMITS.tbt)} hint="Page frozen by scripts" />
              <Metric label="Cumulative Layout Shift" value={cls(r.clsX1000)} tone={toneFor(r.clsX1000, LIMITS.cls)} hint="Content jumping around" />
            </InlineGrid>
            {r.fieldLcpMs >= 0 || r.fieldInpMs >= 0 ? (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="span" variant="headingSm">Real visitors (last 28 days, Chrome users)</Text>
                  <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                    {r.fieldLcpMs >= 0 && <Metric label="LCP" value={secs(r.fieldLcpMs)} tone={toneFor(r.fieldLcpMs, LIMITS.lcp)} hint="75% of visits are faster" />}
                    {r.fieldInpMs >= 0 && <Metric label="Interaction to Next Paint" value={`${r.fieldInpMs} ms`} tone={toneFor(r.fieldInpMs, LIMITS.inp)} hint="Response to taps and clicks" />}
                    {r.fieldClsX1000 >= 0 && <Metric label="CLS" value={cls(r.fieldClsX1000)} tone={toneFor(r.fieldClsX1000, LIMITS.cls)} hint="Layout stability" />}
                  </InlineGrid>
                </BlockStack>
              </Box>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                Google doesn't have enough real-visitor data for this page yet, so only the lab test is shown.
              </Text>
            )}
            {r.opportunities.length > 0 && (
              <BlockStack gap="200">
                <Divider />
                <Text as="span" variant="headingSm">What's slowing this page down</Text>
                {r.opportunities.map((o: any) => (
                  <InlineStack key={o.id} align="space-between" blockAlign="center" wrap={false} gap="200">
                    <Text as="span">
                      {o.title}
                      {o.display ? <Text as="span" tone="subdued">{` — ${o.display}`}</Text> : null}
                    </Text>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      {o.savingsMs > 0 && <Badge>{`Save ~${secs(o.savingsMs)}`}</Badge>}
                      {o.images && <Link to="/app/images">Compress images</Link>}
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}

type Job = { url: string; label: string; strategy: Strategy };

export default function SpeedPage() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const runner = useFetcher<typeof action>();
  const [picked, setPicked] = useState<Record<string, boolean>>({ 0: true });
  const [custom, setCustom] = useState("");
  const [devices, setDevices] = useState<string[]>(["mobile"]);
  const [queue, setQueue] = useState<Job[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(0);
  const running = total > 0;

  const jobs = useMemo(() => {
    const pages: { url: string; label: string }[] = data.targets.filter((_, i) => picked[i]);
    if (custom.trim()) pages.push({ url: custom.trim(), label: custom.trim() });
    return pages.flatMap((p) => devices.map((d) => ({ ...p, strategy: d as Strategy })));
  }, [data.targets, picked, custom, devices]);

  const capped = data.left < 0 ? jobs.length : Math.min(jobs.length, data.left);

  const submit = (job: Job) => runner.submit({ url: job.url, label: job.label, strategy: job.strategy }, { method: "POST" });

  const start = () => {
    const list = jobs.slice(0, capped);
    if (!list.length) return;
    setTotal(list.length);
    setDone(0);
    setFailed(0);
    setQueue(list.slice(1));
    submit(list[0]);
  };

  useEffect(() => {
    const d = runner.data as any;
    if (!running || runner.state !== "idle" || !d) return;
    const nextFailed = failed + (d.ok ? 0 : 1);
    setDone((n) => n + 1);
    setFailed(nextFailed);
    // Every other page of a password-protected store would fail the same way.
    const blocked = !d.ok && /password protected/i.test(String(d.error || ""));
    if (queue.length && !blocked) {
      const [next, ...rest] = queue;
      setQueue(rest);
      submit(next);
      return;
    }
    setTotal(0);
    setQueue([]);
    revalidator.revalidate();
    if (blocked) shopify.toast.show("Your storefront is password protected — Google can't test it", { isError: true });
    else if (nextFailed) shopify.toast.show(nextFailed === 1 && d.error ? d.error : `${nextFailed} test(s) failed — see the results`, { isError: true });
    else shopify.toast.show("Speed test finished");
  }, [runner.state, runner.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Latest run per page + device, newest first.
  const latest = useMemo(() => {
    const seen = new Set<string>();
    return data.recent.filter((r) => {
      const k = `${r.url}|${r.strategy}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [data.recent]);

  return (
    <Page>
      <TitleBar title="Speed test" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Test your store's speed</Text>
                  <Text as="p" tone="subdued">
                    Runs Google PageSpeed Insights — the same test Google uses to judge page experience in search — and shows what slows each page down.
                  </Text>
                </BlockStack>
                {data.allowed && (
                  <Text as="span" tone="subdued">
                    {data.left < 0 ? "Unlimited" : `${data.left} of ${formatLimit(data.cap)} tests left this month`}
                  </Text>
                )}
              </InlineStack>
              {!data.allowed && <UpgradeNotice required={FEATURE_MIN_PLAN.speedTest} />}
              {data.allowed && data.passwordProtected && (
                <Banner tone="warning" title="Your storefront is password protected">
                  <p>
                    Google can't open password-protected pages, so speed tests would fail. Turn off the password in Online Store →
                    Preferences, run the test, and turn it back on afterwards if you need to.
                  </p>
                </Banner>
              )}
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <BlockStack gap="200">
                  <Text as="span" variant="headingSm">Pages</Text>
                  {data.targets.map((t, i) => (
                    <Checkbox
                      key={t.url}
                      label={t.label}
                      helpText={t.url}
                      checked={!!picked[i]}
                      onChange={(v) => setPicked((p) => ({ ...p, [i]: v }))}
                      disabled={!data.allowed || running}
                    />
                  ))}
                  <TextField
                    label="Another page on your store (optional)"
                    placeholder="/pages/about"
                    autoComplete="off"
                    value={custom}
                    onChange={setCustom}
                    disabled={!data.allowed || running}
                    helpText={data.base ? `A path or a full URL on ${data.base}` : undefined}
                  />
                </BlockStack>
                <ChoiceList
                  title="Device"
                  allowMultiple
                  choices={[
                    { label: "Mobile (what Google ranks on)", value: "mobile" },
                    { label: "Desktop", value: "desktop" },
                  ]}
                  selected={devices}
                  onChange={setDevices}
                  disabled={!data.allowed || running}
                />
              </InlineGrid>
              {running && (
                <BlockStack gap="100">
                  <Text as="p">Testing with Google… {done} of {total} done. Each page takes up to a minute — keep this page open.</Text>
                  <ProgressBar progress={Math.max(4, (done / Math.max(1, total)) * 100)} />
                </BlockStack>
              )}
              <InlineStack gap="200" blockAlign="center">
                <Button variant="primary" onClick={start} loading={running} disabled={!data.allowed || running || capped === 0 || data.passwordProtected}>
                  {`Run speed test (${capped})`}
                </Button>
                {data.allowed && jobs.length > capped && <Text as="span" tone="subdued">Only {capped} left this month.</Text>}
                <Text as="span" variant="bodySm" tone="subdued">Password-protected stores can't be tested.</Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {latest.length > 0 && (
          <Layout.Section>
            <BlockStack gap="400">
              {latest.slice(0, 8).map((r) => (
                <ResultCard key={r.id} r={r} />
              ))}
            </BlockStack>
          </Layout.Section>
        )}

        {data.recent.length > 1 && (
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">History</Text>
              </Box>
              <IndexTable
                resourceName={{ singular: "test", plural: "tests" }}
                itemCount={Math.min(30, data.recent.length)}
                selectable={false}
                headings={[{ title: "Date" }, { title: "Page" }, { title: "Device" }, { title: "Score" }, { title: "LCP" }]}
              >
                {data.recent.slice(0, 30).map((r, i) => (
                  <IndexTable.Row id={r.id} key={r.id} position={i}>
                    <IndexTable.Cell>{new Date(r.createdAt).toLocaleString()}</IndexTable.Cell>
                    <IndexTable.Cell>{r.label || r.url}</IndexTable.Cell>
                    <IndexTable.Cell>{r.strategy === "mobile" ? "Mobile" : "Desktop"}</IndexTable.Cell>
                    <IndexTable.Cell>{r.error ? <Badge tone="critical">Failed</Badge> : <Badge tone={scoreTone(r.score)}>{String(r.score)}</Badge>}</IndexTable.Cell>
                    <IndexTable.Cell>{r.error ? "—" : secs(r.lcpMs)}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
