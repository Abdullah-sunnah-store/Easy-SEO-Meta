// Keeps shop.metafields.easy_seo.plan in step with the active plan, so the
// theme's schema embed knows which structured data the plan includes.
import { getActivePlan } from "./billing.server";
import type { PlanName } from "../lib/plans";

type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export async function syncSchemaPlan(admin: AdminClient, known?: PlanName): Promise<PlanName> {
  const plan = known ?? (await getActivePlan(admin));
  try {
    const res = await admin.graphql(`#graphql
      query SeoSchemaPlan { shop { id metafield(namespace: "easy_seo", key: "plan") { value } } }`);
    const body: any = await res.json();
    const shop = body?.data?.shop;
    if (!shop?.id || shop.metafield?.value === plan) return plan;
    const set = await admin.graphql(
      `#graphql
      mutation SeoSchemaPlanSet($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
      { variables: { m: [{ ownerId: shop.id, namespace: "easy_seo", key: "plan", type: "single_line_text_field", value: plan }] } },
    );
    const out: any = await set.json();
    const errs = out?.data?.metafieldsSet?.userErrors;
    if (errs?.length) console.warn("Easy SEO schema: plan metafield:", JSON.stringify(errs));
  } catch (error) {
    // Never block the admin on this; the embed falls back to the Free schema.
    console.warn("Easy SEO schema: plan sync failed:", (error as Error)?.message || error);
  }
  return plan;
}
