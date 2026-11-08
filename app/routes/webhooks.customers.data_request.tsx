import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../lib/webhook.server";

// Mandatory GDPR compliance webhook: customers/data_request.
// authenticate.webhook verifies the HMAC and returns 401 on a bad signature.
// This app does not store customer personal data of its own (orders and
// customer records live in Shopify), so there is nothing to return — we
// acknowledge the request with a 200.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticateWebhook(request);
  console.log(`Received ${topic} for ${shop} — no app-stored customer data.`);
  return new Response();
};
