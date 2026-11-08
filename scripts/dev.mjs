#!/usr/bin/env node
// `npm run dev`, wrapped so it cleans up after itself.
//
// THE PROBLEM THIS SOLVES
//
// `shopify app dev` repoints the INSTALLED app at a Cloudflare tunnel, so the
// embedded iframe loads your local server instead of Vercel. That is what makes
// local development possible — and it is also a live grenade: the moment the
// session ends the tunnel stops resolving, and anyone who opens the app gets
// the browser's "server IP address could not be found" page. A merchant. You.
// An App Store reviewer.
//
// Worse, nothing in the repo shows it. The CLI restores the local .toml files
// on exit, so `git status` is clean and both configs read as Vercel. The stale
// URL lives only in the Partner dashboard, which means the only way to notice
// is for someone to open the app and find it broken.
//
// So the restore does not get left to memory. This wrapper runs
// `shopify app dev`, waits for it to finish however it finishes — Ctrl-C
// included — and then re-releases the production config over whatever the
// dashboard is holding.
//
// The one case it cannot cover is the terminal window being closed outright,
// which kills this process too. If that happens, run `npm run urls:restore`.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// Read from shopify.app.toml so `shopify app config link` is all a new
// checkout needs; DEV_STORE comes from the environment (or the CLI asks).
const APP_TOML = readFileSync("shopify.app.toml", "utf8");
const CLIENT_ID = (APP_TOML.match(/^client_id\s*=\s*"([^"]+)"/m) || [])[1] || "";
const PRODUCTION_HOST = "easy-seo-meta.vercel.app";
const DEV_STORE = process.env.DEV_STORE || "";
const DEV_MANIFEST = ".shopify/dev-bundle/manifest.json";

function run(command) {
  return new Promise((resolve) => {
    // shell: true because `shopify` and `npx` are .cmd shims on Windows and
    // spawn cannot execute those directly.
    const child = spawn(command, { stdio: "inherit", shell: true });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 0)));
    child.on("error", (error) => {
      console.error(`\n! Could not start: ${error.message}\n`);
      resolve(1);
    });
  });
}

/**
 * Did the session actually repoint the app?
 *
 * The CLI records the URLs it pushed in the dev bundle manifest. Reading it
 * back means a dev run that died before it opened a tunnel — a typo, a missing
 * login — does not cost a pointless app version. When the answer is unknowable,
 * restore anyway: a redundant release is free, a stranded tunnel is not.
 */
function needsRestore() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(DEV_MANIFEST, "utf8"));
  } catch {
    return true;
  }

  const urls = JSON.stringify(manifest);
  if (urls.includes(PRODUCTION_HOST) && !urls.includes("trycloudflare.com")) {
    return false;
  }
  return true;
}

async function restore() {
  if (!needsRestore()) {
    console.log("\n▸ The app still points at production — nothing to restore.\n");
    return;
  }

  console.log(
    "\n▸ That session pointed the installed app at a tunnel. Restoring the " +
      "production URLs so the app keeps working…\n",
  );

  const code = await run(
    'npx shopify app deploy --config production --allow-updates --message "restore production URLs after dev"',
  );

  if (code === 0) {
    console.log(`\n▸ Restored. The app points at https://${PRODUCTION_HOST} again.\n`);
  } else {
    console.error(
      "\n! THE RESTORE FAILED. The installed app is still pointing at a dead " +
        "tunnel and will not open.\n! Run `npm run urls:restore` before anyone " +
        "opens it.\n",
    );
    process.exitCode = 1;
  }
}

// Swallow Ctrl-C here so this process outlives the child: the terminal sends
// SIGINT to the whole group, the CLI shuts itself down, and the restore below
// still gets to run. Without this the wrapper would die alongside it and the
// tunnel URL would be left in place — the exact failure this file exists for.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

await run(
  `npx shopify app dev --config shopify.app.toml${CLIENT_ID ? ` --client-id=${CLIENT_ID}` : ""}${DEV_STORE ? ` --store=${DEV_STORE}` : ""}`,
);
await restore();
