import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  LogSeverity,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BILLING_PLANS, PLANS } from "./lib/plans";

// Re-exported for convenience; the source of truth lives in ./lib/plans.
export { PLANS };

/**
 * The app's public origin.
 *
 * SHOPIFY_APP_URL is the configured value and the one that must match the
 * redirect URLs registered with Shopify. Vercel never sets it, so fall back to
 * the host Vercel does inject: VERCEL_PROJECT_PRODUCTION_URL is the stable
 * production domain, VERCEL_URL the per-deployment one. OAuth only works when
 * the value matches a registered redirect URL, so the fallbacks keep the app
 * serving rather than replacing the configured value.
 */
function resolveAppUrl(): string {
  const configured = process.env.SHOPIFY_APP_URL?.trim();
  if (configured) return configured;

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) {
    console.warn(
      `Easy SEO: SHOPIFY_APP_URL is not set — falling back to https://${vercelHost}. ` +
        "OAuth will fail unless that host is a registered redirect URL.",
    );
    return `https://${vercelHost}`;
  }

  return "";
}

const createShopify = () =>
  shopifyApp({
    // Trimmed: a value pasted into the host's multi-line field can carry a
    // trailing newline, and the library compares the session token's audience
    // to apiKey exactly ("Session token had invalid API key").
    apiKey: process.env.SHOPIFY_API_KEY?.trim(),
    apiSecretKey: process.env.SHOPIFY_API_SECRET?.trim() || "",
    apiVersion: ApiVersion.July26,
    scopes: process.env.SCOPES?.split(",").map((s) => s.trim()).filter(Boolean),
    appUrl: resolveAppUrl(),
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    // SHOPIFY_DEBUG=1 on the host turns on the library's debug log, which is the
    // only place it says WHY a session token or token exchange was rejected
    // (wrong client secret, wrong client ID, expired token). Leave it off
    // otherwise: it logs token payloads.
    logger: {
      level: process.env.SHOPIFY_DEBUG === "1" ? LogSeverity.Debug : LogSeverity.Info,
    },
    distribution: AppDistribution.AppStore,
    // One entry per sellable subscription (monthly and yearly of each tier),
    // generated from the same list the Plans page renders.
    billing: Object.fromEntries(
      BILLING_PLANS.map((p) => [
        p.key,
        {
          lineItems: [
            {
              amount: p.amount,
              currencyCode: "USD",
              interval:
                p.cycle === "yearly" ? BillingInterval.Annual : BillingInterval.Every30Days,
            },
          ],
          trialDays: p.trialDays,
        },
      ]),
    ) as any,
    future: {
      unstable_newEmbeddedAuthStrategy: true,
      expiringOfflineAccessTokens: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });

type ShopifyAppServer = ReturnType<typeof createShopify>;

let instance: ShopifyAppServer | undefined;

/**
 * Builds the Shopify app object on first use rather than at import.
 *
 * shopifyApp() validates its config eagerly and throws when SHOPIFY_APP_URL,
 * SHOPIFY_API_KEY or SHOPIFY_API_SECRET is missing. Called at module scope that
 * throw propagates through Remix's server bundle — which imports every route —
 * so one unset variable takes down the whole deployment, /healthz and the
 * mandatory compliance webhooks included, with a platform 500 on every path.
 * That is what a misconfigured Vercel environment did here.
 *
 * Deferring the call keeps the failure on the routes that actually need an
 * admin session. The webhook endpoints verify HMACs from SHOPIFY_API_SECRET
 * directly (see lib/webhook.server.ts) and still answer 401, which is what
 * Shopify's compliance check requires of them.
 */
function getShopify(): ShopifyAppServer {
  if (!instance) {
    try {
      instance = createShopify();
    } catch (error) {
      console.error(
        "Easy SEO: Shopify app initialisation failed — check SHOPIFY_APP_URL, " +
          "SHOPIFY_API_KEY and SHOPIFY_API_SECRET in the hosting environment.",
        error,
      );
      throw error;
    }
  }
  return instance;
}

/**
 * Exposes an object built by getShopify() without building it at import time.
 * Methods are bound to the real object so `authenticate.admin(...)` behaves
 * exactly as it did when the export was the object itself.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = resolve();
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_target, prop) {
      return {
        ...Reflect.getOwnPropertyDescriptor(resolve(), prop),
        configurable: true,
      };
    },
  });
}

const shopify = lazy<ShopifyAppServer>(getShopify);

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders: ShopifyAppServer["addDocumentResponseHeaders"] =
  (...args) => getShopify().addDocumentResponseHeaders(...args);
export const authenticate = lazy<ShopifyAppServer["authenticate"]>(
  () => getShopify().authenticate,
);
export const unauthenticated = lazy<ShopifyAppServer["unauthenticated"]>(
  () => getShopify().unauthenticated,
);
export const login: ShopifyAppServer["login"] = (...args) =>
  getShopify().login(...args);
export const registerWebhooks: ShopifyAppServer["registerWebhooks"] = (
  ...args
) => getShopify().registerWebhooks(...args);
export const sessionStorage = lazy<ShopifyAppServer["sessionStorage"]>(
  () => getShopify().sessionStorage,
);
