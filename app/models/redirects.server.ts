import prisma from "../db.server";
import { gql, userErrorText, type AdminClient, AdminError } from "./admin.server";

export type Redirect = { id: string; path: string; target: string };

export async function listRedirects(admin: AdminClient, opts: { after?: string | null; query?: string }) {
  const data = await gql(admin, `#graphql
    query SeoRedirects($after: String, $query: String) {
      urlRedirects(first: 50, after: $after, query: $query, reverse: true) {
        nodes { id path target }
        pageInfo { hasNextPage endCursor }
      }
    }`, { after: opts.after || null, query: opts.query || null });
  return {
    redirects: (data?.urlRedirects?.nodes ?? []) as Redirect[],
    next: data?.urlRedirects?.pageInfo?.hasNextPage ? (data.urlRedirects.pageInfo.endCursor as string) : null,
  };
}

/**
 * Creates a 301. "Already exists" is treated as success when `tolerateExisting`
 * (auto-redirects mustn't fail because Shopify's own handle-change redirect got
 * there first).
 */
export async function createRedirect(
  admin: AdminClient,
  shop: string,
  path: string,
  target: string,
  reason: string,
  tolerateExisting = false,
): Promise<string | null> {
  const data = await gql(admin, `#graphql
    mutation SeoRedirectCreate($urlRedirect: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $urlRedirect) { urlRedirect { id } userErrors { field message } }
    }`, { urlRedirect: { path, target } });
  const errors = data?.urlRedirectCreate?.userErrors ?? [];
  if (errors.length) {
    const text = userErrorText(errors);
    if (tolerateExisting && /taken|already|exists/i.test(text)) return null;
    throw new AdminError(text);
  }
  const id = data?.urlRedirectCreate?.urlRedirect?.id ?? null;
  await prisma.redirectLog.create({ data: { shop, path, target, reason } }).catch(() => undefined);
  return id;
}

export async function deleteRedirect(admin: AdminClient, id: string) {
  const data = await gql(admin, `#graphql
    mutation SeoRedirectDelete($id: ID!) {
      urlRedirectDelete(id: $id) { deletedUrlRedirectId userErrors { field message } }
    }`, { id });
  const err = userErrorText(data?.urlRedirectDelete?.userErrors);
  if (err) throw new AdminError(err);
}

/** Imports a slice of CSV rows; returns per-row results. */
export async function importRedirects(
  admin: AdminClient,
  shop: string,
  rows: { path: string; target: string }[],
) {
  const results: { path: string; ok: boolean; error?: string }[] = [];
  for (const r of rows) {
    try {
      await createRedirect(admin, shop, r.path, r.target, "csv");
      results.push({ path: r.path, ok: true });
    } catch (e: any) {
      results.push({ path: r.path, ok: false, error: String(e?.message || e) });
    }
  }
  return results;
}
