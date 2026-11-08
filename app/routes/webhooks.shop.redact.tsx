import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import db from "../db.server";

// Mandatory GDPR webhook: shop/redact, 48h after uninstall. Erase every row
// keyed by this shop. (Files the merchant kept in Shopify — such as photo
// backups — live in their store, not here.)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticateWebhook(request);
  console.log(`Received ${topic} for ${shop} — erasing all shop data.`);
  await Promise.all([
    db.session.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    db.auditRun.deleteMany({ where: { shop } }),
    db.auditItem.deleteMany({ where: { shop } }),
    db.auditImage.deleteMany({ where: { shop } }),
    db.linkRef.deleteMany({ where: { shop } }),
    db.productHandle.deleteMany({ where: { shop } }),
    db.usage.deleteMany({ where: { shop } }),
    db.compressedImage.deleteMany({ where: { shop } }),
    db.redirectLog.deleteMany({ where: { shop } }),
  ]);
  return new Response();
};
