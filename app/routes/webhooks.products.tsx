import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import prisma from "../db.server";
import { getActivePlanCached } from "../models/billing.server";
import { can } from "../lib/plans";
import { createRedirect } from "../models/redirects.server";
import { autoFillNewProduct } from "../models/newProduct.server";

// products/create, products/update, products/delete.
//
//  create  → remember the handle; on Basic+, fill empty SEO fields and image
//            alt text (templates, or AI when switched on) — see newProduct.server.
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
      await autoFillNewProduct({ admin, shop, plan, settings, productId, payload: p });
    }
  } catch (error) {
    console.error(`Easy SEO ${topic} for ${shop}:`, error);
  }
  return new Response();
};
