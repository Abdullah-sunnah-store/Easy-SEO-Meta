import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import prisma from "../db.server";
import { refCookie } from "../models/affiliate.server";
import { LISTING_URL, cleanCode } from "../lib/affiliate";

// Affiliate link: /r/CODE → counts the click, remembers the code, and sends the
// visitor to the App Store listing. When the store then opens the app, the
// code is read back (app.tsx) and the store is credited to the affiliate.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const code = cleanCode(params.code || "");
  const affiliate = code
    ? await prisma.affiliate.findUnique({ where: { code }, select: { id: true, status: true } })
    : null;

  if (!affiliate || affiliate.status !== "approved") return redirect(LISTING_URL);

  await prisma.affiliate.update({ where: { id: affiliate.id }, data: { clicks: { increment: 1 } } }).catch(() => {});
  const target = `${LISTING_URL}?utm_source=affiliate&utm_medium=referral&utm_campaign=${encodeURIComponent(code)}`;
  return redirect(target, { headers: { "Set-Cookie": await refCookie.serialize(code) } });
};
