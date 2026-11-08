import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate, useRevalidator, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Select,
  TextField,
  IndexTable,
  Tabs,
  EmptyState,
  ProgressBar,
  Box,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActivePlan } from "../models/billing.server";
import { addUsage, remaining } from "../models/usage.server";
import { applyTemplateBatch, renderFor, saveItemSeo, shopName, type BulkScope } from "../models/meta.server";
import { AdminError } from "../models/admin.server";
import { AiError, aiConfigured, generateMeta, loadSource, type AiField } from "../models/ai.server";
import { ISSUES, parseIssues, scoreTone, type IssueCode } from "../lib/audit";
import { DESCRIPTION_MAX, RESOURCES, RESOURCE_LABEL, TITLE_MAX, type Resource } from "../lib/templates";
import { can, formatLimit, limit, FEATURE_MIN_PLAN } from "../lib/plans";

const PAGE_SIZE = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const resource = (RESOURCES as string[]).includes(url.searchParams.get("resource") || "")
    ? (url.searchParams.get("resource") as Resource)
    : "product";
  const issue = url.searchParams.get("issue") || "";
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10) || 0);

  const where: any = { shop, resource };
  if (issue && issue in ISSUES) where.issues = { contains: `"${issue}"` };
  if (q) where.title = { contains: q, mode: "insensitive" };

  const plan = await getActivePlan(admin);
  const [items, total, settings, left, name, aiLeft] = await Promise.all([
    prisma.auditItem.findMany({ where, orderBy: [{ score: "asc" }, { title: "asc" }], skip: page * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditItem.count({ where }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    remaining(shop, plan, "metaEdits"),
    shopName(admin, shop),
    remaining(shop, plan, "aiGenerations"),
  ]);
  const missingCount = await prisma.auditItem.count({ where: { shop, resource, OR: [{ seoTitle: "" }, { seoDescription: "" }] } });
  const counts = await prisma.auditItem.groupBy({ by: ["resource"], where: { shop }, _count: true });

  return {
    resource,
    issue,
    q,
    page,
    total,
    missingCount,
    counts: Object.fromEntries(counts.map((c) => [c.resource, c._count])),
    items: items.map((it) => ({
      id: it.id,
      resourceId: it.resourceId,
      title: it.title,
      path: it.path,
      seoTitle: it.seoTitle,
      seoDescription: it.seoDescription,
      issues: parseIssues(it.issues),
      score: it.score,
      suggestion: renderFor(resource, settings?.templates ?? "{}", it, name),
    })),
    left: Number.isFinite(left) ? left : -1,
    monthlyCap: limit(plan, "metaEdits"),
    allResources: can(plan, "allResources"),
    storeName: name,
    ai: {
      enabled: aiConfigured(),
      left: Number.isFinite(aiLeft) ? aiLeft : -1,
      cap: limit(plan, "aiGenerations"),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "save") {
      const item = await prisma.auditItem.findUnique({
        where: { shop_resourceId: { shop, resourceId: String(form.get("resourceId")) } },
        select: { resource: true },
      });
      if (!item) return { ok: false, error: "That item isn't in the audit any more — run the audit again." };
      if (item.resource !== "product" && !can(await getActivePlan(admin), "allResources")) {
        return { ok: false, error: `Editing this is on the ${FEATURE_MIN_PLAN.allResources} plan.` };
      }
      await saveItemSeo(admin, shop, {
        resourceId: String(form.get("resourceId")),
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
      });
      return { ok: true, saved: true };
    }
    if (intent === "ai") {
      const resourceId = String(form.get("resourceId"));
      const field = (["title", "description", "both"].includes(String(form.get("field"))) ? String(form.get("field")) : "both") as AiField;
      const item = await prisma.auditItem.findUnique({
        where: { shop_resourceId: { shop, resourceId } },
        select: { resource: true },
      });
      if (!item) return { ok: false, error: "That item isn't in the audit any more — run the audit again." };
      const plan = await getActivePlan(admin);
      if (item.resource !== "product" && !can(plan, "allResources")) {
        return { ok: false, error: `Editing this is on the ${FEATURE_MIN_PLAN.allResources} plan.` };
      }
      if ((await remaining(shop, plan, "aiGenerations")) <= 0) {
        return { ok: false, error: "You've used this month's AI writes. Upgrade for more, or write it by hand." };
      }
      const written = await generateMeta(await loadSource(admin, resourceId), await shopName(admin, shop));
      // Counted only once the AI actually answered — a failed call costs nothing.
      await addUsage(shop, "aiGenerations", 1);
      return {
        ok: true,
        ai: {
          field,
          ...(field !== "description" ? { title: written.title } : {}),
          ...(field !== "title" ? { description: written.description } : {}),
        },
      };
    }
    if (intent === "bulk") {
      const plan = await getActivePlan(admin);
      const allowance = await remaining(shop, plan, "metaEdits");
      const resource = String(form.get("resource")) as Resource;
      if (resource !== "product" && !can(plan, "allResources")) {
        return { ok: false, error: `Editing ${RESOURCE_LABEL[resource].toLowerCase()} is on the ${FEATURE_MIN_PLAN.allResources} plan.` };
      }
      const result = await applyTemplateBatch({
        admin,
        shop,
        resource,
        scope: String(form.get("scope")) as BulkScope,
        ids: JSON.parse(String(form.get("ids") || "[]")),
        afterId: String(form.get("afterId") || ""),
        allowance: Number.isFinite(allowance) ? allowance : 10_000,
      });
      await addUsage(shop, "metaEdits", result.applied);
      return { ok: true, bulk: result };
    }
  } catch (error) {
    console.error("Easy SEO meta:", error);
    if (error instanceof AiError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof AdminError ? `Shopify said: ${error.message}` : "Saving failed. Try again." };
  }
  return { ok: false, error: "Unknown action." };
};

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.trim().length;
  return (
    <Text as="span" variant="bodySm" tone={n > max ? "critical" : n === 0 ? "subdued" : "success"}>
      {n}/{max}
    </Text>
  );
}

function SerpPreview({ title, description, path, store }: { title: string; description: string; path: string; store: string }) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <Text as="p" variant="bodySm" tone="subdued">{store.toLowerCase().replace(/\s+/g, "")}.com › {path.split("/").filter(Boolean).join(" › ")}</Text>
      <p style={{ color: "#1a0dab", fontSize: 18, lineHeight: "24px", margin: "2px 0" }}>{title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) + "…" : title}</p>
      <Text as="p" variant="bodySm">{description.length > DESCRIPTION_MAX ? description.slice(0, DESCRIPTION_MAX) + "…" : description || "Google will pick text from the page."}</Text>
    </Box>
  );
}

export default function MetaPage() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const saver = useFetcher<typeof action>();
  const bulk = useFetcher<typeof action>();
  const writer = useFetcher<typeof action>();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [query, setQuery] = useState(data.q);
  const [run, setRun] = useState<{ scope: BulkScope; ids: string[]; applied: number } | null>(null);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(data.items, {
    resourceIDResolver: (it) => it.id,
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  useEffect(() => {
    const d = saver.data as any;
    if (d?.saved) {
      shopify.toast.show("Saved to Shopify");
      setEditing(null);
    } else if (d?.error) shopify.toast.show(d.error, { isError: true });
  }, [saver.data, shopify]);

  // AI writes land in the draft only; nothing reaches Shopify until Save.
  useEffect(() => {
    const d = writer.data as any;
    if (writer.state !== "idle" || !d) return;
    if (d.error) shopify.toast.show(d.error, { isError: true });
    else if (d.ai) {
      setDraft((cur) => ({
        title: d.ai.title ?? cur.title,
        description: d.ai.description ?? cur.description,
      }));
      shopify.toast.show("AI draft added — review it, then Save");
      revalidator.revalidate(); // refresh the "AI writes left" count
    }
  }, [writer.state, writer.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bulk apply: keep going batch by batch until done or out of allowance.
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
      shopify.toast.show(d.bulk.limited ? `Applied to ${applied} — monthly limit reached` : `Template applied to ${applied}`);
      setRun(null);
      clearSelection();
      revalidator.revalidate();
      return;
    }
    setRun({ ...run, applied });
    bulk.submit(
      { intent: "bulk", resource: data.resource, scope: run.scope, ids: JSON.stringify(run.ids), afterId: d.bulk.lastId },
      { method: "POST" },
    );
  }, [bulk.state, bulk.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const startBulk = (scope: BulkScope) => {
    const ids = scope === "selected" ? (allResourcesSelected ? data.items.map((i) => i.id) : selectedResources) : [];
    setRun({ scope, ids, applied: 0 });
    bulk.submit({ intent: "bulk", resource: data.resource, scope, ids: JSON.stringify(ids), afterId: "" }, { method: "POST" });
  };

  const current = data.items.find((i) => i.id === editing);
  const aiField = writer.state !== "idle" ? String(writer.formData?.get("field") ?? "") : "";
  const aiDisabled = !data.ai.enabled || data.ai.left === 0 || writer.state !== "idle";
  const aiHint = !data.ai.enabled
    ? "AI writing isn't set up on this app yet."
    : data.ai.left === 0
      ? "No AI writes left this month."
      : data.ai.left < 0
        ? ""
        : `${data.ai.left} of ${formatLimit(data.ai.cap)} AI writes left this month`;
  const writeWithAi = (field: AiField) =>
    current && writer.submit({ intent: "ai", field, resourceId: current.resourceId }, { method: "POST" });
  const tabs = RESOURCES.map((r) => ({ id: r, content: `${RESOURCE_LABEL[r]} (${data.counts[r] ?? 0})` }));
  const locked = data.resource !== "product" && !data.allResources;
  const issueOptions = [
    { label: "All issues", value: "" },
    ...(Object.keys(ISSUES) as IssueCode[]).map((c) => ({ label: ISSUES[c].label, value: c })),
  ];

  return (
    <Page>
      <TitleBar title="Meta tags" />
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={RESOURCES.indexOf(data.resource)} onSelect={(i) => setParam("resource", RESOURCES[i])} />
          </Card>
        </Layout.Section>

        {locked && (
          <Layout.Section>
            <Banner tone="info">
              Auditing and editing {RESOURCE_LABEL[data.resource].toLowerCase()} is on the {FEATURE_MIN_PLAN.allResources} plan.{" "}
              <Link to="/app/plans">View plans</Link>
            </Banner>
          </Layout.Section>
        )}

        {current && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">{current.title}</Text>
                  <Button variant="plain" onClick={() => setEditing(null)}>Close</Button>
                </InlineStack>
                <TextField
                  label="SEO title"
                  autoComplete="off"
                  value={draft.title}
                  onChange={(v) => setDraft((d) => ({ ...d, title: v }))}
                  placeholder={current.title}
                  connectedRight={<Box paddingInline="200" paddingBlockStart="150"><Counter value={draft.title} max={TITLE_MAX} /></Box>}
                  helpText={
                    <InlineStack gap="200" blockAlign="center">
                      <span>Empty = Shopify uses the title.</span>
                      <Button variant="plain" size="slim" disabled={aiDisabled} loading={aiField === "title"} onClick={() => writeWithAi("title")}>
                        ✨ Write with AI
                      </Button>
                    </InlineStack>
                  }
                />
                <TextField
                  label="Meta description"
                  autoComplete="off"
                  multiline={3}
                  value={draft.description}
                  onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
                  helpText={
                    <InlineStack gap="200" blockAlign="center">
                      <Counter value={draft.description} max={DESCRIPTION_MAX} />
                      <span>Empty = Google picks text from the page.</span>
                      <Button variant="plain" size="slim" disabled={aiDisabled} loading={aiField === "description"} onClick={() => writeWithAi("description")}>
                        ✨ Write with AI
                      </Button>
                    </InlineStack>
                  }
                />
                <InlineStack gap="200" blockAlign="center">
                  <Button variant="primary" tone="success" disabled={aiDisabled} loading={aiField === "both"} onClick={() => writeWithAi("both")}>
                    ✨ Write both with AI
                  </Button>
                  <Button onClick={() => setDraft({ title: current.suggestion.title, description: current.suggestion.description })}>
                    Fill from template
                  </Button>
                  {aiHint && <Text as="span" variant="bodySm" tone="subdued">{aiHint}</Text>}
                </InlineStack>
                <SerpPreview title={draft.title || current.title} description={draft.description} path={current.path} store={data.storeName} />
                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    loading={saver.state !== "idle"}
                    onClick={() => saver.submit({ intent: "save", resourceId: current.resourceId, ...draft }, { method: "POST" })}
                  >
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Bulk apply template</Text>
                <Text as="span" tone="subdued">
                  {data.left < 0 ? "Unlimited" : `${data.left} of ${formatLimit(data.monthlyCap)} left this month`} ·{" "}
                  <Link to="/app/settings">Edit templates</Link>
                </Text>
              </InlineStack>
              {run && (
                <BlockStack gap="100">
                  <Text as="p">Applying… {run.applied} done</Text>
                  <ProgressBar progress={Math.min(95, (run.applied / Math.max(1, run.scope === "missing" ? data.missingCount : run.scope === "all" ? data.total : run.ids.length)) * 100)} />
                </BlockStack>
              )}
              <InlineStack gap="200">
                <Button variant="primary" disabled={!!run || locked || data.missingCount === 0 || data.left === 0} onClick={() => startBulk("missing")}>
                  {`Fill missing (${data.missingCount})`}
                </Button>
                <Button disabled={!!run || locked || selectedResources.length === 0 || data.left === 0} onClick={() => startBulk("selected")}>
                  {`Apply to selected (${allResourcesSelected ? data.items.length : selectedResources.length})`}
                </Button>
                <Button disabled={!!run || locked || data.left === 0} onClick={() => startBulk("all")} tone="critical" variant="secondary">
                  Overwrite all
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                "Fill missing" only writes empty fields and keeps what you wrote by hand.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="300">
              <InlineStack gap="300" blockAlign="end">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    autoComplete="off"
                    placeholder="Search by title"
                    value={query}
                    onChange={setQuery}
                    onBlur={() => setParam("q", query)}
                    clearButton
                    onClearButtonClick={() => { setQuery(""); setParam("q", ""); }}
                  />
                </div>
                <Select label="Issue" labelHidden options={issueOptions} value={data.issue} onChange={(v) => setParam("issue", v)} />
              </InlineStack>
            </Box>
            {data.items.length === 0 ? (
              <EmptyState heading={data.total === 0 && !data.issue && !data.q ? "Nothing scanned yet" : "Nothing matches"} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png" action={data.total === 0 ? { content: "Run an audit", onAction: () => navigate("/app") } : undefined}>
                <p>{data.total === 0 ? "Run an SEO audit from the dashboard first." : "Try another filter."}</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "item", plural: "items" }}
                itemCount={data.items.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[{ title: "Title" }, { title: "SEO title" }, { title: "Meta description" }, { title: "Score" }, { title: "" }]}
              >
                {data.items.map((it, index) => (
                  <IndexTable.Row id={it.id} key={it.id} position={index} selected={selectedResources.includes(it.id)}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">{it.title}</Text>
                        <InlineStack gap="100">
                          {it.issues.slice(0, 3).map((c) => (
                            <Badge key={c} tone={ISSUES[c].severity === "critical" ? "critical" : "warning"} size="small">{ISSUES[c].label}</Badge>
                          ))}
                          {it.issues.length > 3 && <Badge size="small">{`+${it.issues.length - 3}`}</Badge>}
                        </InlineStack>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone={it.seoTitle ? undefined : "subdued"}>{it.seoTitle || "—"}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <div style={{ maxWidth: 320, whiteSpace: "normal" }}>
                        <Text as="span" tone={it.seoDescription ? undefined : "subdued"}>{it.seoDescription ? it.seoDescription.slice(0, 90) + (it.seoDescription.length > 90 ? "…" : "") : "—"}</Text>
                      </div>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={scoreTone(it.score)}>{String(it.score)}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button
                        size="slim"
                        disabled={locked}
                        onClick={() => {
                          setEditing(it.id);
                          setDraft({ title: it.seoTitle, description: it.seoDescription });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Edit
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
            {data.total > PAGE_SIZE && (
              <Box padding="300">
                <InlineStack align="center" gap="300">
                  <Button disabled={data.page === 0} onClick={() => setParam("page", String(data.page - 1))}>Previous</Button>
                  <Text as="span">Page {data.page + 1} of {Math.ceil(data.total / PAGE_SIZE)}</Text>
                  <Button disabled={(data.page + 1) * PAGE_SIZE >= data.total} onClick={() => setParam("page", String(data.page + 1))}>Next</Button>
                </InlineStack>
              </Box>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
