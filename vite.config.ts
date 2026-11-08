import { vitePlugin as remix } from "@remix-run/dev";
import { vercelPreset } from "@vercel/remix/vite";
import { installGlobals } from "@remix-run/node";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals({ nativeFetch: true });

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the remix server. The CLI will eventually
// stop passing in HOST, so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    // The tunnel hostname changes on every run and is not what SHOPIFY_APP_URL
    // points at, so Vite's host check rejects it with 403 unless the tunnel
    // domains are allowed wholesale.
    allowedHosts: [host, ".trycloudflare.com", ".loca.lt", ".ngrok-free.app"],
    cors: {
      preflightContinue: true,
    },
    // Bind IPv4 explicitly. Left as the default "localhost", Node resolves to
    // ::1 on Windows while the Shopify CLI proxy dials 127.0.0.1 — the dev
    // server then runs fine but every proxied request is ECONNREFUSED. It
    // surfaces after any restart that rebinds the port (editing .env is one).
    host: "127.0.0.1",
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      // Build for Vercel's Node runtime. Without this preset the build only
      // produces a plain Remix server bundle; Vercel then wraps it in a
      // function with no handler to call and every request - the embedded
      // iframe included - answers 500 FUNCTION_INVOCATION_FAILED. That is
      // the error the App Store reviewer hit. The preset is version-locked
      // to @remix-run/dev (both 2.16.7); it declares that as an exact peer.
      presets: [vercelPreset()],
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
        v3_routeConfig: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react", "@shopify/polaris"],
  },
}) satisfies UserConfig;
