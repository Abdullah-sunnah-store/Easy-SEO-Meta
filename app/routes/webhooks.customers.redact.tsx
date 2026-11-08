import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";

// Mandatory GDPR compliance webhook: customers/redact.
// The app stores no customer PII in its own database, so there is nothing to
// erase — acknowledge with 200. (HMAC is verified by authenticate.webhook,
// which returns 401 on a bad signature.)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticateWebhook(request);
  console.log(`Received ${topic} for ${shop} — no app-stored customer data to redact.`);
  return new Response();
};
