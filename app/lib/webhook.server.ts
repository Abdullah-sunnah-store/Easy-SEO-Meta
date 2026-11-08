import { createHmac, timingSafeEqual } from "node:crypto";
import { authenticate } from "../shopify.server";

// Webhook authentication, following Shopify's documented HMAC verification:
// https://shopify.dev/docs/apps/build/webhooks/verify-deliveries#hmac-verification
//
// The rules that matter there:
//   • HMAC-SHA256 the RAW request body, keyed with the app's client secret
//   • the X-Shopify-Hmac-Sha256 header is base64 — decode before comparing
//   • compare with a timing-safe equality check, never ===
//   • reject any delivery whose signatures don't match (400 or 401)
//   • acknowledge a good delivery with 200; anything outside 2xx counts as an
//     error, and Shopify gives up after a 5s request timeout
//
// authenticate.webhook() already does all of this. The explicit pass below runs
// first as defence in depth: it fails closed if the library's behaviour ever
// changes, and it makes the verification auditable in our own code rather than
// buried in a dependency.

/**
 * Constant-time comparison of the computed digest against the header value.
 * Returns false for a missing header, an unset secret, or any length mismatch —
 * timingSafeEqual throws when the buffers differ in length.
 */
function hmacMatches(rawBody: string, headerValue: string | null): boolean {
  if (!headerValue) return false;
  const secret = process.env.SHOPIFY_API_SECRET?.trim() || "";
  if (!secret) return false;

  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(headerValue, "base64");
  } catch {
    return false;
  }
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(computed, provided);
}

/**
 * Verifies a webhook delivery and returns the parsed Shopify context.
 *
 * Throws a 401 Response for anything that isn't a genuine, correctly signed
 * delivery — an unsigned probe included. (The library alone answers 400 when the
 * Shopify headers are absent; the docs permit either, but 401 is the more
 * accurate description of an unauthenticated request.)
 */
export async function authenticateWebhook(request: Request) {
  // clone() so the body stays unread for authenticate.webhook below — reading
  // the original would leave it with an empty stream.
  const rawBody = await request.clone().text();
  const header = request.headers.get("x-shopify-hmac-sha256");

  if (!hmacMatches(rawBody, header)) {
    console.warn(
      "Easy SEO: rejected webhook with an invalid signature",
      JSON.stringify({
        path: new URL(request.url).pathname,
        topic: request.headers.get("x-shopify-topic"),
        shop: request.headers.get("x-shopify-shop-domain"),
        hmac: header ? "present-but-invalid" : "absent",
      }),
    );
    throw new Response("Unauthorized", { status: 401 });
  }

  try {
    return await authenticate.webhook(request);
  } catch (error) {
    // Keep the status honest if the library rejects it for its own reasons.
    // Headers missing or the wrong method: a malformed request, not ours to
    // process. Anything else past our signature check is a session problem.
    if (error instanceof Response && (error.status === 400 || error.status === 405)) {
      throw new Response("Unauthorized", { status: error.status === 400 ? 401 : 405 });
    }
    // The signature is already verified above, so this delivery is genuine.
    // What failed is the library loading the shop's offline session: with
    // expiring offline tokens it refreshes an expired access token first, and
    // after an uninstall Shopify refuses that refresh. Every app/uninstalled
    // and shop/redact for a shop installed over an hour earlier then answered
    // 500 and was retried for hours (seen on the App Review store).
    // Hand back the context without an admin client instead: the cleanup
    // handlers need only the shop, and the rest already treat a missing admin
    // as "no session".
    console.warn(
      `${LOG_PREFIX} webhook session unavailable, continuing without admin:`,
      error instanceof Response ? `HTTP ${error.status}` : (error as any)?.message || error,
    );
    return contextFromHeaders(request.headers, rawBody);
  }
}

const LOG_PREFIX = "Easy SEO:";

function contextFromHeaders(headers: Headers, rawBody: string) {
  let payload: any = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    payload = {};
  }
  return {
    shop: headers.get("x-shopify-shop-domain") || "",
    topic: (headers.get("x-shopify-topic") || "").toUpperCase().replace(/\//g, "_"),
    apiVersion: headers.get("x-shopify-api-version") || "",
    webhookId: headers.get("x-shopify-webhook-id") || "",
    payload,
    session: undefined,
    admin: undefined,
  } as unknown as Awaited<ReturnType<typeof authenticate.webhook>>;
}
