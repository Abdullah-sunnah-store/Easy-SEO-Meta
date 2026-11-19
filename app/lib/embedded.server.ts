// Keeps the "Shop domain" log-in form out of the Shopify admin.
//
// The app has no accounts of its own: inside the admin it signs in with the
// session token Shopify issues. The library sends a request to /auth/login only
// when it can't tell which shop it is for, which on an embedded load means the
// `shop` search param was lost on the way. Showing a log-in form there is what
// App Store review flagged (4.5.4): the reviewer had no "credentials" to type.
//
// Every embedded load still carries `host` — base64 of the admin URL, e.g.
// "admin.shopify.com/store/my-shop" — so the shop can be recovered from it and
// the request sent back into the normal embedded flow.

const RETRY_PARAM = "easyseo_resume";
const SHOP_RE =/^[a-zA-Z0-9][a-zA-Z0-9-_]*\.myshopify\.com$/;

export function sanitizeShop(value: string | null | undefined): string | null {
  const shop = String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return SHOP_RE.test(shop) ? shop : null;
}

/** Shop domain from the `host` param ("admin.shopify.com/store/x" or "x.myshopify.com/admin"). */
export function shopFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(host.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  const unified = decoded.match(/^admin\.shopify\.com\/store\/([a-zA-Z0-9][a-zA-Z0-9-_]*)/);
  if (unified) return sanitizeShop(`${unified[1]}.myshopify.com`);
  const legacy = decoded.match(/^([a-zA-Z0-9][a-zA-Z0-9-_]*\.myshopify\.com)\/admin/);
  return legacy ? sanitizeShop(legacy[1]) : null;
}

/** True when the request is being loaded inside the Shopify admin iframe. */
export function isEmbeddedRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.searchParams.get("embedded") === "1" ||
    url.searchParams.has("host") ||
    request.headers.get("sec-fetch-dest") === "iframe"
  );
}

/**
 * For an embedded request whose shop can be worked out, the /app URL that
 * resumes the normal session-token flow; otherwise null.
 */
export function embeddedAppUrl(request: Request): string | null {
  if (!isEmbeddedRequest(request)) return null;
  const url = new URL(request.url);
  // Already sent back once and still landed here: stop rather than loop.
  if (url.searchParams.has(RETRY_PARAM)) return null;
  const shop = sanitizeShop(url.searchParams.get("shop")) ?? shopFromHost(url.searchParams.get("host"));
  if (!shop) return null;
  const params = new URLSearchParams(url.searchParams);
  params.set("shop", shop);
  params.set("embedded", "1");
  params.set(RETRY_PARAM, "1");
  return `/app?${params.toString()}`;
}
