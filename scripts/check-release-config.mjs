#!/usr/bin/env node
// Pre-flight for `npm run deploy`. Refuses to release a broken app.
//
// This exists because of a real App Store rejection: the released version
// carried a Cloudflare tunnel URL that had long since stopped resolving, so
// the reviewer's embedded iframe rendered Chrome's "server IP address could
// not be found", and the review failed under 2.3.3 and 2.1.1. Every check
// below maps to a way that outcome can happen again.
//
// Usage:  node scripts/check-release-config.mjs [config.toml] [--skip-live]

import fs from "node:fs";

const args = process.argv.slice(2);
const skipLive = args.includes("--skip-live");
const configPath =
  args.find((a) => !a.startsWith("--")) ?? "shopify.app.production.toml";

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

if (!fs.existsSync(configPath)) {
  console.error("✗ " + configPath + " does not exist.");
  process.exit(1);
}
const toml = fs.readFileSync(configPath, "utf8");

// Line-oriented TOML reading, tracking the current [section]. Deliberately not
// a real parser: this has to run on a fresh clone before `npm install`, so it
// takes no dependency.
function parse(text) {
  const out = { "": {} };
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      section = header[1];
      if (!out[section]) out[section] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).replace(/\s+#.*$/, "").trim();
    if (!out[section]) out[section] = {};
    if (!(key in out[section])) out[section][key] = value; // first wins
  }
  return out;
}

const unquote = (v) => v.replace(/^"([\s\S]*)"$/, "$1");
const cfg = parse(toml);
const get = (section, key) => {
  const v = cfg[section] && cfg[section][key];
  return v === undefined ? undefined : unquote(v);
};

const clientId = get("", "client_id") || "";
if (!clientId || clientId.startsWith("REPLACE")) {
  fail(
    "client_id is still a placeholder. Create the app once with `shopify app config link`" +
      " (see docs/SETUP.md) and copy its client_id into " + configPath + " and shopify.app.toml.",
  );
}

// Hostnames that are temporary by construction. Any of these in a released
// version is a guaranteed dead link the moment the tunnel or laptop goes away.
const EPHEMERAL = [
  "trycloudflare.com",
  "ngrok.io",
  "ngrok-free.app",
  "ngrok.app",
  "loca.lt",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
];

const appUrl = get("", "application_url");
if (!appUrl) fail("application_url is missing.");

let origin = null;
function originOf(raw, label) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail(label + " is not a valid URL: " + raw);
    return null;
  }
  if (u.protocol !== "https:") {
    fail(label + " must be https, got " + u.protocol + "//");
  }
  const bad = EPHEMERAL.find(
    (h) => u.hostname === h || u.hostname.endsWith("." + h),
  );
  if (bad) {
    fail(
      label +
        " points at an ephemeral host (" +
        u.hostname +
        "). A released version must use the permanent production hostname, never a dev tunnel.",
    );
  }
  return u.origin;
}

if (appUrl) origin = originOf(appUrl, "application_url");

// The proxy and every OAuth callback must live on the same origin as the app.
// A mismatch means the storefront form 404s, or OAuth lands nowhere.
const proxyUrl = get("app_proxy", "url");
if (!proxyUrl) {
  fail(
    "[app_proxy] url is missing - /apps/easy-seo/llms.txt would 404 and the /llms.txt redirect would point at nothing.",
  );
} else {
  const o = originOf(proxyUrl, "[app_proxy] url");
  if (o && origin && o !== origin) {
    fail(
      "[app_proxy] url origin (" +
        o +
        ") does not match application_url origin (" +
        origin +
        ").",
    );
  }
}

const redirects = [
  ...toml.matchAll(/"(https?:\/\/[^"]*\/(?:auth|api)\/[^"]*)"/g),
].map((m) => m[1]);
if (redirects.length === 0) {
  fail("[auth] redirect_urls is empty - OAuth cannot complete.");
}
for (const r of redirects) {
  const o = originOf(r, "redirect_url " + r);
  if (o && origin && o !== origin) {
    fail(
      "redirect_url origin (" +
        o +
        ") does not match application_url origin (" +
        origin +
        ").",
    );
  }
}

// --- Webhook endpoints -----------------------------------------------------
// The CLI builds a webhook endpoint by CONCATENATING a relative uri onto
// application_url rather than resolving it as a URL. application_url here ends
// in /app, so `uri = "/webhooks/app/uninstalled"` shipped as
// ".../app/webhooks/app/uninstalled" - a 404. That failed the "Verifies
// webhooks with HMAC signatures" review check (Shopify saw a 404 where a
// signed 401 belongs) and silently stopped app/uninstalled from ever firing.
//
// Resolve each uri exactly the way the CLI does, and insist on the result
// living on the app origin.
const webhookUris = [...toml.matchAll(/^\s*uri\s*=\s*"([^"]+)"/gm)]
  .map((m) => m[1])
  .filter((u) => u.includes("/webhooks/"));

if (webhookUris.length === 0) {
  fail("No [[webhooks.subscriptions]] uri entries found - the mandatory compliance webhooks are missing.");
}

const resolvedWebhooks = [];
for (const uri of webhookUris) {
  // Concatenation, not new URL(): this must mirror the CLI's behaviour, bug
  // and all, or the check tests a URL Shopify never registers.
  const resolved = uri.startsWith("http") ? uri : (appUrl ?? "") + uri;
  resolvedWebhooks.push(resolved);
  const o = originOf(resolved, "webhook uri " + uri);
  if (o && origin && o !== origin) {
    fail(
      "webhook uri " + uri + " resolves to " + resolved +
        ", which is not on the app origin (" + origin + ").",
    );
    continue;
  }
  let path;
  try {
    path = new URL(resolved).pathname;
  } catch {
    continue;
  }
  if (!path.startsWith("/webhooks/")) {
    fail(
      "webhook uri " + uri + " resolves to " + resolved + ". The app serves " +
        "webhooks at /webhooks/*, so Shopify would get a 404 instead of a " +
        "signed 401 - which fails the HMAC review check and stops the webhook " +
        "firing. Write the uri as an absolute https URL: " +
        origin + path.replace(/^.*(\/webhooks\/)/, "$1"),
    );
  }
}

// The switch that lets `shopify app dev` overwrite these URLs with a tunnel.
if (get("build", "automatically_update_urls_on_dev") !== "false") {
  fail(
    "automatically_update_urls_on_dev must be false in the release config, otherwise a stray `shopify app dev` run rewrites the published app's URLs to a tunnel.",
  );
}

// --- Admin API version agreement -------------------------------------------
// A retired API version fails review on its own, and the versions living in
// three separate files are exactly what drifted last time.
const MONTHS = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const versions = new Map();
const tomlApi = get("webhooks", "api_version");
if (tomlApi) versions.set(configPath, tomlApi);

const extRoot = "extensions";
if (fs.existsSync(extRoot)) {
  for (const dir of fs.readdirSync(extRoot)) {
    const f = extRoot + "/" + dir + "/shopify.extension.toml";
    if (!fs.existsSync(f)) continue;
    const v = parse(fs.readFileSync(f, "utf8"))[""].api_version;
    if (v) versions.set(f, unquote(v));
  }
}

const serverPath = "app/shopify.server.ts";
if (fs.existsSync(serverPath)) {
  const name = fs
    .readFileSync(serverPath, "utf8")
    .match(/apiVersion:\s*ApiVersion\.(\w+)/)?.[1];
  const parts = name && name.match(/^([A-Za-z]+)(\d{2})$/);
  const month = parts && MONTHS[parts[1].toLowerCase()];
  if (month) versions.set(serverPath, "20" + parts[2] + "-" + month);
  else if (name) {
    notes.push(
      "Could not decode ApiVersion." + name + " in " + serverPath + "; check it by hand.",
    );
  }
}

if (new Set(versions.values()).size > 1) {
  const shown = [...versions].map((e) => e[0] + "=" + e[1]).join(", ");
  fail("Admin API version drift across files: " + shown + ". They must all match.");
} else if (versions.size) {
  notes.push(
    "Admin API version " +
      [...versions.values()][0] +
      " agrees across " +
      versions.size +
      " file(s)",
  );
}

// --- Liveness --------------------------------------------------------------
// The check that would have caught the rejection: is anything actually there?
if (!skipLive && origin && failures.length === 0) {
  const url = origin + "/healthz";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "manual" });
    clearTimeout(timer);
    if (res.status !== 200) {
      fail(
        url +
          " answered " +
          res.status +
          ", expected 200. Nothing usable is serving the production hostname - releasing now would repeat the rejection.",
      );
      if (res.headers.get("x-vercel-error")) {
        fail(
          "Vercel reports x-vercel-error: " +
            res.headers.get("x-vercel-error") +
            ". The deployment is not serving. FUNCTION_INVOCATION_FAILED " +
            "almost always means a missing environment variable " +
            "(SHOPIFY_API_KEY, SHOPIFY_API_SECRET, DATABASE_URL) - check the " +
            "runtime logs for the deployment before releasing.",
        );
      }
    } else {
      notes.push(url + " -> 200 OK");
    }
  } catch (err) {
    const why =
      err && err.name === "AbortError"
        ? "timed out after 30s"
        : (err && err.cause && err.cause.code) ||
          (err && err.message) ||
          String(err);
    fail(
      url +
        " is unreachable (" +
        why +
        '). If DNS cannot resolve the hostname, the reviewer sees "server IP address could not be found" - the exact failure this app was rejected for.',
    );
  }
}

// Shopify's "Verifies webhooks with HMAC signatures" review check posts an
// invalidly-signed delivery to the registered compliance endpoints and expects
// 401. Ask the deployed app the same question, at the same URL Shopify will.
if (!skipLive && failures.length === 0) {
  const target = resolvedWebhooks.find((u) => u.includes("/customers/data_request"));
  if (target) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(target, {
        method: "POST",
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "customers/data_request",
          "X-Shopify-Shop-Domain": "release-preflight.myshopify.com",
          "X-Shopify-Hmac-Sha256": "cHJlZmxpZ2h0LWludmFsaWQtc2lnbmF0dXJl",
        },
        body: JSON.stringify({ shop_domain: "release-preflight.myshopify.com" }),
      });
      clearTimeout(timer);
      if (res.status === 401) {
        notes.push(target + " rejects an invalid HMAC with 401");
      } else {
        fail(
          target + " answered " + res.status + " to an invalidly-signed " +
            "webhook, expected 401. This is exactly what the App Store's " +
            '"Verifies webhooks with HMAC signatures" check tests. A 404 means ' +
            "the uri resolves to a path the app does not serve; anything else " +
            "means the handler is not rejecting bad signatures.",
        );
      }
    } catch (err) {
      fail(
        target + " is unreachable (" + ((err && err.message) || String(err)) +
          "), so Shopify's HMAC check cannot pass either.",
      );
    }
  }
}

console.log("\nRelease pre-flight - " + configPath);
if (origin) console.log("  origin: " + origin);
for (const n of notes) console.log("  . " + n);

if (failures.length) {
  console.error("\n✗ " + failures.length + " problem(s) - refusing to deploy:\n");
  for (const f of failures) console.error("  * " + f);
  console.error(
    "\nFix these, then run `npm run deploy` again. Use --skip-live only when the host is known-good and merely unreachable from here.\n",
  );
  process.exit(1);
}
console.log("\n✓ Safe to release.\n");
