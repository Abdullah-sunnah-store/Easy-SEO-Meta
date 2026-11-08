// Thin Admin GraphQL helper: throws on top-level errors, retries throttling.

export type AdminClient = { graphql: (q: string, o?: any) => Promise<Response> };

export class AdminError extends Error {}

export async function gql<T = any>(admin: AdminClient, query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await admin.graphql(query, variables ? { variables } : undefined);
    const body: any = await response.json();
    const errors: any[] = body?.errors ?? [];
    if (errors.some((e) => e?.extensions?.code === "THROTTLED") && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (errors.length) throw new AdminError(errors.map((e) => e.message).join(" "));
    return body.data as T;
  }
  throw new AdminError("Shopify is rate-limiting requests. Try again in a moment.");
}

export function userErrorText(errors: { message: string }[] | undefined): string {
  return (errors ?? []).map((e) => e.message).join(" ");
}
