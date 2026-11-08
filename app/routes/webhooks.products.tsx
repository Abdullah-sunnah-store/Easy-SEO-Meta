import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import prisma from "../db.server";
import { getActivePlanCached } from "../models/billing.server";
import { can } from "../lib/plans";
import { createRedirect } from "../models/redirects.server";
import { renderFor, shopName, writeAlt, writeSeo } from "../models/meta.server";
import { parseTemplates, renderTemplate, htmlToText } from "../lib/templates";

// products/create, products/update, products/delete.
//
//  create  → remember the handle; on Basic+, fill empty SEO fields and image
//            alt text from the merchant's templates (when switched on).
//  update  → if the handle changed, 301 the old URL to the new one (Basic+).
//  delete  → 301 the old URL to the chosen target (all plans). The delete
//            payload carries only the id, which is why handles are stored.
//
// Webhooks must answer fast and never fail on a merchant-side problem, so
// everything after authentication is best-effort and logged.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticateWebhook(request);
  const p: any = payload;
  const productId: string = p?.admin_graphql_api_id ?? (p?.id ? `gid://shopify/Product/${p.id}` : "");
  if (!productId) return new Response();

  try {
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    const stored = await prisma.productHandle.findUnique({ where: { shop_productId: { shop, productId } } });
    const t = String(topic).toLowerCase().replace("_", "/");

    if (t.endsWith("delete")) {
      if (stored && admin && (settings?.autoRedirectDeleted ?? true)) {
        await createRedirect(admin, shop, `/products/${stored.handle}`, settings?.deletedRedirectTarget || "/collections/all", "deleted", true);
      }
      await prisma.productHandle.deleteMany({ where: { shop, productId } });
      await prisma.auditItem.deleteMany({ where: { shop, resourceId: productId } });
      await prisma.auditImage.deleteMany({ where: { shop, productId } });
      return new Response();
    }

    const handle: string = p?.handle ?? "";
    if (!handle) return new Response();
    await prisma.productHandle.upsert({
      where: { shop_productId: { shop, productId } },
      create: { shop, productId, handle },
      update: { handle },
    });
    if (!admin) return new Response();
    const plan = await getActivePlanCached(shop, admin);

    if (t.endsWith("update") && stored && stored.handle !== handle && (settings?.autoRedirectHandleChange ?? true) && can(plan, "handleRedirects")) {
      await createRedirect(admin, shop, `/products/${stored.handle}`, `/products/${handle}`, "handle_change", true);
    }

    if (t.endsWith("create") && settings?.autoMetaNewProducts && can(plan, "autoMeta")) {
      const name = await shopName(admin, shop);
      const text = htmlToText(p?.body_html ?? "");
      const price = p?.variants?.[0]?.price;
      const item = {
        title: p?.title ?? "",
        extra: JSON.stringify({ vendor: p?.vendor ?? "", productType: p?.product_type ?? "", price: price ? String(price) : "", excerpt: text.slice(0, 300) }),
      };
      const meta = renderFor("product", settings.templates, item, name);
      await writeSeo(admin, [{ resourceId: productId, title: meta.title, description: meta.description }]);
      const altTemplate = parseTemplates(settings.templates).alt;
      const media: any[] = (p?.media ?? p?.images ?? []).filter((m: any) => m?.admin_graphql_api_id?.includes("MediaImage") && !m?.alt);
      if (media.length) {
        await writeAlt(admin, media.map((m, i) => ({
          mediaId: m.admin_graphql_api_id,
          alt: renderTemplate(altTemplate, { product_title: item.title, shop: name, vendor: p?.vendor ?? "", n: i > 0 ? i + 1 : "" }, 125),
        })));
      }
    }
  } catch (error) {
    console.error(`Easy SEO ${topic} for ${shop}:`, error);
  }
  return new Response();
};
