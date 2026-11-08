import type { ActionFunctionArgs } from "@remix-run/node";
import { action as appScopesUpdate } from "./webhooks.app.scopes_update";
import { action as appUninstalled } from "./webhooks.app.uninstalled";
import { action as customersDataRequest } from "./webhooks.customers.data_request";
import { action as customersRedact } from "./webhooks.customers.redact";
import { action as shopRedact } from "./webhooks.shop.redact";

// Alias for the webhook endpoints under /app/webhooks/*.
//
// The canonical paths are /webhooks/* (routes/webhooks.*.tsx). But a relative
// webhook `uri` in the app config is resolved against application_url at deploy
// time, so an application_url carrying an /app path registers every webhook at
// /app/webhooks/... — which matched no route, and is what Shopify's compliance
// probe hit at /app/webhooks/shop/redact.
//
// The right fix is an application_url with no path, which the config files
// enforce. This exists so a stale registration can't fail the compliance check
// again: either path reaches the same handler, and the handler verifies the
// HMAC exactly as before. It grants nothing — an unsigned request still gets
// 401 here.
//
// The trailing underscore in the filename (`app_.`) keeps this out of the
// app.tsx layout. Nested under it, every delivery would hit authenticate.admin()
// and be bounced to OAuth instead of being processed.
const HANDLERS: Record<
  string,
  (args: ActionFunctionArgs) => Promise<Response>
> = {
  "app/uninstalled": appUninstalled,
  "app/scopes_update": appScopesUpdate,
  "customers/data_request": customersDataRequest,
  "customers/redact": customersRedact,
  "shop/redact": shopRedact,
};

export const action = async (args: ActionFunctionArgs) => {
  const topic = args.params["*"] ?? "";
  const handler = HANDLERS[topic];
  if (!handler) {
    // An unknown path here is a misregistration worth seeing in the logs, not a
    // silent 200 that would hide it.
    console.warn(`Easy SEO: no webhook handler for /app/webhooks/${topic}`);
    return new Response("Not Found", { status: 404 });
  }
  return handler(args);
};
