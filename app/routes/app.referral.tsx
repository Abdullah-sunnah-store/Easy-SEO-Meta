import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { attributeShop } from "../models/affiliate.server";

// The merchant types a referral code on Home. A valid code credits the store to
// that affiliate and adds REFERRAL_TRIAL_BONUS days to the paid plans' trial.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const result = await attributeShop(session.shop, String(form.get("code") ?? ""), "code");
  return result.ok ? { ok: true } : { ok: false, error: result.error ?? "That referral code isn't valid." };
};
