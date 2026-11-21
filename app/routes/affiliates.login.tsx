import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, FormLayout, Text } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import prisma from "../db.server";
import { AffiliateShell, Field, shellLinkStyle } from "../components/AffiliateShell";
import { commit, currentAffiliate, getSession, verifyPassword } from "../models/affiliate.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta: MetaFunction = () => [{ title: "Affiliate log in — Easy SEO & Meta" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await currentAffiliate(request)) throw redirect("/affiliates/dashboard");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const affiliate = email ? await prisma.affiliate.findUnique({ where: { email } }) : null;
  if (!affiliate || !verifyPassword(password, affiliate.passwordHash)) {
    return { error: "Wrong email or password." };
  }
  const session = await getSession(request);
  session.set("affiliateId", affiliate.id);
  return redirect("/affiliates/dashboard", { headers: await commit(session) });
};

export default function AffiliateLogin() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <AffiliateShell right={<a href="/affiliates" style={shellLinkStyle}>Join the program</a>}>
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text as="h1" variant="headingLg">Affiliate log in</Text>
              {data?.error && <Banner tone="critical">{data.error}</Banner>}
              <Field label="Email" name="email" type="email" autoComplete="email" />
              <Field label="Password" name="password" type="password" autoComplete="current-password" />
              <Button submit variant="primary" loading={busy}>Log in</Button>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">
                  Forgot your password? Message us on the support contact in the app listing and we'll reset it.
                </Text>
              </BlockStack>
            </FormLayout>
          </Form>
        </Card>
      </div>
    </AffiliateShell>
  );
}
