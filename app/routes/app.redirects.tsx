import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
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
  TextField,
  Checkbox,
  IndexTable,
  ProgressBar,
  DropZone,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getActivePlan } from "../models/billing.server";
import { createRedirect, deleteRedirect, importRedirects, listRedirects } from "../models/redirects.server";
import { getSettings, updateSettings } from "../models/settings.server";
import { AdminError } from "../models/admin.server";
import { parseRedirectCsv } from "../lib/csv";
import { can, FEATURE_MIN_PLAN } from "../lib/plans";
import { UpgradeNotice } from "../components/UpgradeNotice";

const REASON: Record<string, string> = {
  deleted: "Product deleted",
  handle_change: "URL changed",
  broken_link: "Broken link fix",
  csv: "CSV import",
  manual: "Added here",
  llms: "llms.txt",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const after = url.searchParams.get("after");
  const plan = await getActivePlan(admin);
  const [list, settings, log, broken] = await Promise.all([
    listRedirects(admin, { after, query: q ? `path:*${q.replace(/[^\w/.-]/g, "")}*` : undefined }),
    getSettings(shop),
    prisma.redirectLog.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.linkRef.findMany({ where: { shop, broken: true }, orderBy: { path: "asc" }, take: 200 }),
  ]);
  return {
    q,
    redirects: list.redirects,
    next: list.next,
    settings: {
      autoRedirectDeleted: settings.autoRedirectDeleted,
      autoRedirectHandleChange: settings.autoRedirectHandleChange,
      deletedRedirectTarget: settings.deletedRedirectTarget,
    },
    log: log.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    broken: broken.map((b) => ({ id: b.id, path: b.path, sourceTitle: b.sourceTitle, sourceType: b.sourceType })),
    can: {
      csv: can(plan, "csvRedirects"),
      handle: can(plan, "handleRedirects"),
      broken: can(plan, "brokenLinks"),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const plan = await getActivePlan(admin);
  try {
    if (intent === "create" || intent === "fixBroken") {
      if (intent === "fixBroken" && !can(plan, "brokenLinks")) return { ok: false, error: `On the ${FEATURE_MIN_PLAN.brokenLinks} plan.` };
      const path = String(form.get("path") || "").trim();
      const target = String(form.get("target") || "").trim();
      if (!path.startsWith("/")) return { ok: false, error: "The old path must start with /" };
      if (!target) return { ok: false, error: "Enter where it should go." };
      await createRedirect(admin, shop, path, target, intent === "fixBroken" ? "broken_link" : "manual");
      if (intent === "fixBroken") await prisma.linkRef.updateMany({ where: { shop, path: path.toLowerCase() }, data: { broken: false } });
      return { ok: true, message: "Redirect created" };
    }
    if (intent === "delete") {
      await deleteRedirect(admin, String(form.get("id")));
      return { ok: true, message: "Redirect deleted" };
    }
    if (intent === "import") {
      if (!can(plan, "csvRedirects")) return { ok: false, error: `CSV import is on the ${FEATURE_MIN_PLAN.csvRedirects} plan.` };
      const rows = JSON.parse(String(form.get("rows") || "[]")).slice(0, 25);
      const results = await importRedirects(admin, shop, rows);
      return { ok: true, imported: results };
    }
    if (intent === "settings") {
      await updateSettings(shop, {
        autoRedirectDeleted: form.get("autoRedirectDeleted") === "true",
        autoRedirectHandleChange: can(plan, "handleRedirects") && form.get("autoRedirectHandleChange") === "true",
        deletedRedirectTarget: String(form.get("deletedRedirectTarget") || "/collections/all").trim() || "/collections/all",
      });
      return { ok: true, message: "Settings saved" };
    }
  } catch (error) {
    console.error("Easy SEO redirects:", error);
    return { ok: false, error: error instanceof AdminError ? `Shopify said: ${error.message}` : "Something went wrong." };
  }
  return { ok: false, error: "Unknown action." };
};

function BrokenRow({ item, onFix, busy }: { item: any; onFix: (target: string) => void; busy: boolean }) {
  const [target, setTarget] = useState(item.path.startsWith("/products/") ? "/collections/all" : "/");
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold" breakWord>{item.path}</Text>
          <Text as="span" variant="bodySm" tone="subdued">Linked from {item.sourceType} "{item.sourceTitle}"</Text>
        </BlockStack>
      </div>
      <div style={{ width: 220 }}>
        <TextField label="Redirect to" labelHidden autoComplete="off" value={target} onChange={setTarget} />
      </div>
      <Button onClick={() => onFix(target)} loading={busy}>Create redirect</Button>
    </InlineStack>
  );
}

export default function RedirectsPage() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const importer = useFetcher<typeof action>();
  const [path, setPath] = useState("");
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState(data.q);
  const [settings, setSettings] = useState(data.settings);
  const [csv, setCsv] = useState("");
  const [importRun, setImportRun] = useState<{ queue: { path: string; target: string }[]; ok: number; failed: { path: string; error?: string }[]; total: number } | null>(null);

  const parsed = useMemo(() => parseRedirectCsv(csv), [csv]);
  const valid = parsed.filter((r) => !r.error);

  useEffect(() => {
    const d = fetcher.data as any;
    if (fetcher.state !== "idle" || !d) return;
    if (d.message) {
      shopify.toast.show(d.message);
      if (d.message === "Redirect created") { setPath(""); setTarget(""); }
      revalidator.revalidate();
    }
    if (d.error) shopify.toast.show(d.error, { isError: true });
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = importer.data as any;
    if (!importRun || importer.state !== "idle" || !d) return;
    if (d.error) {
      shopify.toast.show(d.error, { isError: true });
      setImportRun(null);
      return;
    }
    const ok = importRun.ok + d.imported.filter((r: any) => r.ok).length;
    const failed = [...importRun.failed, ...d.imported.filter((r: any) => !r.ok)];
    const queue = importRun.queue.slice(25);
    if (!queue.length) {
      shopify.toast.show(`Imported ${ok} redirects${failed.length ? `, ${failed.length} failed` : ""}`);
      setImportRun({ queue: [], ok, failed, total: importRun.total });
      setCsv("");
      revalidator.revalidate();
      return;
    }
    setImportRun({ ...importRun, queue, ok, failed });
    importer.submit({ intent: "import", rows: JSON.stringify(queue.slice(0, 25)) }, { method: "POST" });
  }, [importer.state, importer.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const startImport = () => {
    const rows = valid.map(({ path, target }) => ({ path, target }));
    setImportRun({ queue: rows, ok: 0, failed: [], total: rows.length });
    importer.submit({ intent: "import", rows: JSON.stringify(rows.slice(0, 25)) }, { method: "POST" });
  };

  const submit = (fields: Record<string, string>) => fetcher.submit(fields, { method: "POST" });
  const importing = !!importRun && importRun.queue.length > 0;

  return (
    <Page>
      <TitleBar title="Redirects & links" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Automatic redirects</Text>
              <Checkbox
                label="When a product is deleted, redirect its URL (keeps its search ranking and avoids a 404)"
                checked={settings.autoRedirectDeleted}
                onChange={(v) => setSettings((s) => ({ ...s, autoRedirectDeleted: v }))}
              />
              <Box paddingInlineStart="600">
                <TextField
                  label="Send deleted products to"
                  autoComplete="off"
                  value={settings.deletedRedirectTarget}
                  onChange={(v) => setSettings((s) => ({ ...s, deletedRedirectTarget: v }))}
                  disabled={!settings.autoRedirectDeleted}
                  helpText="A path like /collections/all or /collections/sale."
                />
              </Box>
              <Checkbox
                label="When a product's URL handle changes, redirect the old URL to the new one"
                checked={settings.autoRedirectHandleChange && data.can.handle}
                onChange={(v) => setSettings((s) => ({ ...s, autoRedirectHandleChange: v }))}
                disabled={!data.can.handle}
                helpText={data.can.handle ? undefined : `On the ${FEATURE_MIN_PLAN.handleRedirects} plan.`}
              />
              <InlineStack>
                <Button onClick={() => submit({ intent: "settings", ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])) })} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "settings"}>
                  Save
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Auto-redirects work for products the app knows about — run the audit once so it learns your catalogue.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <div id="broken" />
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Broken internal links</Text>
                {data.can.broken && <Badge tone={data.broken.length ? "critical" : "success"}>{String(data.broken.length)}</Badge>}
              </InlineStack>
              {!data.can.broken ? (
                <UpgradeNotice required={FEATURE_MIN_PLAN.brokenLinks} />
              ) : data.broken.length === 0 ? (
                <Text as="p" tone="subdued">
                  No links to missing pages found in your descriptions and blog posts. (Found during the audit — run it again after big changes.)
                </Text>
              ) : (
                <BlockStack gap="300">
                  <Text as="p" tone="subdued">
                    These links in your product descriptions, pages and blog posts point at pages that don't exist. A redirect fixes them for visitors and search engines without editing the content.
                  </Text>
                  {data.broken.map((b, i) => (
                    <BlockStack key={b.id} gap="300">
                      {i > 0 && <Divider />}
                      <BrokenRow
                        item={b}
                        busy={fetcher.state !== "idle" && fetcher.formData?.get("path") === b.path}
                        onFix={(t) => submit({ intent: "fixBroken", path: b.path, target: t })}
                      />
                    </BlockStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Add a redirect</Text>
              <InlineGrid columns={{ xs: 1, md: "1fr 1fr auto" }} gap="300" alignItems="end">
                <TextField label="Old path" autoComplete="off" value={path} onChange={setPath} placeholder="/products/old-name" />
                <TextField label="Redirect to" autoComplete="off" value={target} onChange={setTarget} placeholder="/products/new-name" />
                <Button variant="primary" onClick={() => submit({ intent: "create", path, target })} loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "create"}>
                  Add
                </Button>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Import redirects from CSV</Text>
              {!data.can.csv && <UpgradeNotice required={FEATURE_MIN_PLAN.csvRedirects} />}
              <DropZone
                accept=".csv,text/csv,text/plain"
                allowMultiple={false}
                disabled={!data.can.csv || importing}
                onDrop={async (_files, accepted) => accepted[0] && setCsv(await accepted[0].text())}
              >
                <DropZone.FileUpload actionTitle="Choose CSV" actionHint="Two columns: old path, new path or URL" />
              </DropZone>
              <TextField
                label="…or paste rows"
                autoComplete="off"
                multiline={4}
                value={csv}
                onChange={setCsv}
                disabled={!data.can.csv || importing}
                placeholder={"/old-page,/pages/new-page\n/products/old,/products/new"}
              />
              {parsed.length > 0 && (
                <Text as="p" tone={parsed.length > valid.length ? "caution" : "subdued"}>
                  {valid.length} redirects ready
                  {parsed.length > valid.length && ` · ${parsed.length - valid.length} rows skipped (${parsed.filter((r) => r.error).slice(0, 3).map((r) => `line ${r.line}: ${r.error}`).join("; ")})`}
                </Text>
              )}
              {importRun && (
                <BlockStack gap="100">
                  <ProgressBar progress={((importRun.total - importRun.queue.length) / Math.max(1, importRun.total)) * 100} />
                  <Text as="p" variant="bodySm">
                    {importRun.ok} imported{importRun.failed.length ? `, ${importRun.failed.length} failed` : ""} of {importRun.total}
                  </Text>
                  {importRun.failed.length > 0 && !importing && (
                    <Banner tone="warning">
                      {importRun.failed.slice(0, 5).map((f) => `${f.path}: ${f.error}`).join(" · ")}
                      {importRun.failed.length > 5 && ` · and ${importRun.failed.length - 5} more`}
                    </Banner>
                  )}
                </BlockStack>
              )}
              <InlineStack>
                <Button variant="primary" disabled={!data.can.csv || !valid.length || importing} onClick={startImport}>
                  {`Import ${valid.length} redirects`}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {data.log.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Recent redirects by Easy SEO</Text>
                {data.log.map((l) => (
                  <InlineStack key={l.id} align="space-between" wrap={false}>
                    <Text as="span" breakWord>{l.path} → {l.target}</Text>
                    <InlineStack gap="200">
                      <Badge>{REASON[l.reason] ?? l.reason}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">{new Date(l.createdAt).toLocaleDateString()}</Text>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <Box padding="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">All redirects in your store</Text>
                <div style={{ width: 280 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    autoComplete="off"
                    placeholder="Search old paths"
                    value={query}
                    onChange={setQuery}
                    onBlur={() => setParams(query ? { q: query } : {})}
                    clearButton
                    onClearButtonClick={() => { setQuery(""); setParams({}); }}
                  />
                </div>
              </InlineStack>
            </Box>
            <IndexTable
              resourceName={{ singular: "redirect", plural: "redirects" }}
              itemCount={data.redirects.length}
              selectable={false}
              emptyState={<Box padding="400"><Text as="p" tone="subdued">No redirects.</Text></Box>}
              headings={[{ title: "Old path" }, { title: "Redirects to" }, { title: "" }]}
            >
              {data.redirects.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell><Text as="span" breakWord>{r.path}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" breakWord>{r.target}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button size="slim" tone="critical" variant="plain" onClick={() => submit({ intent: "delete", id: r.id })}>Delete</Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            <Box padding="300">
              <InlineStack align="end" gap="200">
                {params.get("after") && <Button onClick={() => setParams(data.q ? { q: data.q } : {})}>First page</Button>}
                <Button disabled={!data.next} onClick={() => setParams({ ...(data.q ? { q: data.q } : {}), after: data.next! })}>Next</Button>
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
