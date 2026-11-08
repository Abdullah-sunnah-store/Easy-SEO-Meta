import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { regenerateLlms } from "../models/llms.server";

// /apps/easy-seo/llms.txt on the shop's own domain, via the app proxy.
// Served from the cached copy; regenerated when older than a day.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) return new Response("Not found", { status: 404 });
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  if (!settings?.llmsEnabled) return new Response("Not found", { status: 404 });

  let text = settings.llmsText;
  const stale = !settings.llmsGeneratedAt || Date.now() - settings.llmsGeneratedAt.getTime() > MAX_AGE_MS;
  if ((stale || !text) && admin) {
    text = await regenerateLlms(admin, session.shop).catch(() => text);
  }
  return new Response(text || "", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
};
