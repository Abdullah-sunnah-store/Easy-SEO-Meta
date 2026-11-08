// Internal links in descriptions/bodies, normalised to storefront paths.

const CHECKED = /^\/(products|collections|pages|blogs)\//;

/**
 * Storefront paths of internal links in `html`. Absolute links count when they
 * point at one of the shop's own hosts. Locale prefixes (/fr/, /en-us/) and
 * /collections/x/products/y are reduced to the canonical path; query strings
 * and fragments are dropped. Only product, collection, page and blog URLs are
 * returned — those are the ones that can point at something deleted.
 */
export function internalPaths(html: string, hosts: string[]): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  const own = hosts.map((h) => h.toLowerCase());
  while ((m = re.exec(String(html || "")))) {
    const path = normalisePath(m[2], own);
    if (path) out.add(path);
  }
  return [...out];
}

export function normalisePath(href: string, ownHosts: string[]): string | null {
  let raw = href.trim().replace(/&amp;/g, "&");
  if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) return null;
  if (/^(https?:)?\/\//i.test(raw)) {
    try {
      const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      if (!ownHosts.includes(u.hostname.toLowerCase())) return null;
      raw = u.pathname;
    } catch {
      return null;
    }
  }
  if (!raw.startsWith("/")) return null;
  let path = raw.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep as is */
  }
  path = path.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/(products|collections|pages|blogs)\/)/, "");
  path = path.replace(/^\/collections\/[^/]+(\/products\/[^/]+)$/, "$1");
  if (path === "/collections/all") return null;
  return CHECKED.test(path) ? path : null;
}
