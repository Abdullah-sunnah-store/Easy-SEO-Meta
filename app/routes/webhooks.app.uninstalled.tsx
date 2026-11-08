import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticateWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Deliveries repeat, and may arrive with no session (already deleted, or the
  // offline token could no longer be refreshed) — delete unconditionally.
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
