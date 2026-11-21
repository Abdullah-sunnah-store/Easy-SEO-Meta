import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { destroy, getSession } from "../models/affiliate.server";

async function logout(request: Request) {
  const session = await getSession(request);
  return redirect("/affiliates", { headers: await destroy(session) });
}

export const action = ({ request }: ActionFunctionArgs) => logout(request);
export const loader = ({ request }: LoaderFunctionArgs) => logout(request);
