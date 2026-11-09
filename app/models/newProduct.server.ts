// Filling in SEO for a product the moment it's created (products/create).
//
// Only empty fields are written: an SEO title or description the merchant typed
// while creating the product is kept, and so is any image alt text. The title
// and description come from the product templates, or from the AI when the
// shop turned that on and has AI writes left; an AI answer that's slower than
// AI_DEADLINE_MS (Shopify gives a webhook 5 s) falls back to the template.

import { gql, type AdminClient } from "./admin.server";
import { aiConfigured, generateMeta } from "./ai.server";
import { renderFor, shopName, writeAlt, writeSeo } from "./meta.server";
import { addUsage, remaining } from "./usage.server";
import { htmlToText, parseTemplates, renderTemplate } from "../lib/templates";
import type { PlanName } from "../lib/plans";

const CURRENT_SEO = `#graphql
  query SeoCurrentProductSeo($id: ID!) {
    product(id: $id) { seo { title description } }
  }`;

export const AI_DEADLINE_MS = 3_500;

export async function autoFillNewProduct(args: {
  admin: AdminClient;
  shop: string;
  plan: PlanName;
  settings: { templates: string; autoMetaAi?: boolean | null };
  productId: string;
  payload: any;
  deadlineMs?: number;
}): Promise<{ wrote: "none" | "template" | "ai"; alts: number }> {
  const { admin, shop, plan, settings, productId, payload: p } = args;
  const name = await shopName(admin, shop);
  const text = htmlToText(p?.body_html ?? "");
  const price = p?.variants?.[0]?.price;
  const item = {
    title: p?.title ?? "",
    extra: JSON.stringify({ vendor: p?.vendor ?? "", productType: p?.product_type ?? "", price: price ? String(price) : "", excerpt: text.slice(0, 300) }),
  };

  let wrote: "none" | "template" | "ai" = "none";
  const current = (await gql<any>(admin, CURRENT_SEO, { id: productId }))?.product?.seo ?? {};
  const haveTitle = String(current.title ?? "").trim();
  const haveDesc = String(current.description ?? "").trim();
  if (!haveTitle || !haveDesc) {
    let meta = renderFor("product", settings.templates, item, name);
    wrote = "template";
    if (settings.autoMetaAi && aiConfigured() && (await remaining(shop, plan, "aiGenerations")) > 0) {
      const written = await Promise.race([
        generateMeta(
          {
            kind: "product",
            title: item.title,
            text,
            vendor: p?.vendor || undefined,
            productType: p?.product_type || undefined,
            tags: String(p?.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean).slice(0, 10),
            price: price ? String(price) : undefined,
          },
          name,
        ).catch((e) => {
          console.warn(`Easy SEO: AI for new product ${productId} failed, using template:`, e?.message || e);
          return null;
        }),
        new Promise<null>((r) => setTimeout(() => r(null), args.deadlineMs ?? AI_DEADLINE_MS)),
      ]);
      if (written) {
        meta = written;
        wrote = "ai";
        await addUsage(shop, "aiGenerations", 1);
      }
    }
    await writeSeo(admin, [{ resourceId: productId, title: haveTitle || meta.title, description: haveDesc || meta.description }]);
  }

  const altTemplate = parseTemplates(settings.templates).alt;
  const media: any[] = (p?.media ?? p?.images ?? []).filter((m: any) => m?.admin_graphql_api_id?.includes("MediaImage") && !m?.alt);
  if (media.length) {
    await writeAlt(
      admin,
      media.map((m, i) => ({
        mediaId: m.admin_graphql_api_id,
        alt: renderTemplate(altTemplate, { product_title: item.title, shop: name, vendor: p?.vendor ?? "", n: i > 0 ? i + 1 : "" }, 125),
      })),
    );
  }
  return { wrote, alts: media.length };
}
