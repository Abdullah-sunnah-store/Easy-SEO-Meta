import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineGrid,
  List,
  Select,
  Text,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import prisma from "../db.server";
import { AffiliateShell, Field, shellLinkStyle } from "../components/AffiliateShell";
import { commit, currentAffiliate, getSession, hashPassword, uniqueCode } from "../models/affiliate.server";
import {
  FIRST_RATE,
  MIN_WITHDRAW,
  PAYOUT_DAYS_MAX,
  PAYOUT_DAYS_MIN,
  PAYOUT_METHODS,
  RECURRING_RATE,
  REFERRAL_TRIAL_BONUS,
  commissionFor,
  planPrice,
  usd,
} from "../lib/affiliate";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta: MetaFunction = () => [
  { title: "Affiliate program — Easy SEO & Meta" },
  { name: "description", content: "Earn 50% of the first payment and 10% every month after for each store you refer to Easy SEO & Meta." },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const affiliate = await currentAffiliate(request);
  return { signedIn: Boolean(affiliate) };
};

type Errors = Partial<Record<string, string>>;

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const data = {
    name: get("name"),
    email: get("email").toLowerCase(),
    phone: get("phone"),
    password: String(form.get("password") ?? ""),
    payoutMethod: get("payoutMethod"),
    payoutNumber: get("payoutNumber").replace(/[^0-9+]/g, ""),
    payoutName: get("payoutName"),
    website: get("website"),
    promotion: get("promotion"),
    terms: form.has("terms"),
  };

  const errors: Errors = {};
  if (data.name.length < 2) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = "Enter a valid email.";
  if (data.phone.replace(/\D/g, "").length < 10) errors.phone = "Enter your phone number.";
  if (data.password.length < 8) errors.password = "Use at least 8 characters.";
  if (!PAYOUT_METHODS.some((m) => m.value === data.payoutMethod)) errors.payoutMethod = "Choose bKash or Nagad.";
  if (!/^(\+?88)?01[3-9]\d{8}$/.test(data.payoutNumber)) errors.payoutNumber = "Enter a valid Bangladeshi mobile number (01XXXXXXXXX).";
  if (data.website.length < 4) errors.website = "Tell us your website, page or channel.";
  if (data.promotion.length < 10) errors.promotion = "Tell us in a sentence or two how you'll promote the app.";
  if (!data.terms) errors.terms = "Please accept the program rules.";
  if (!errors.email && (await prisma.affiliate.findUnique({ where: { email: data.email }, select: { id: true } }))) {
    errors.email = "An account with this email already exists. Log in instead.";
  }
  if (Object.keys(errors).length) return { errors };

  const affiliate = await prisma.affiliate.create({
    data: {
      code: await uniqueCode(data.name),
      name: data.name.slice(0, 120),
      email: data.email.slice(0, 200),
      phone: data.phone.slice(0, 40),
      passwordHash: hashPassword(data.password),
      payoutMethod: data.payoutMethod,
      payoutNumber: data.payoutNumber.slice(0, 20),
      payoutName: data.payoutName.slice(0, 120),
      website: data.website.slice(0, 500),
      promotion: data.promotion.slice(0, 2000),
    },
  });
  const session = await getSession(request);
  session.set("affiliateId", affiliate.id);
  return redirect("/affiliates/dashboard", { headers: await commit(session) });
};

export default function AffiliatesHome() {
  const { signedIn } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors: Errors = actionData?.errors ?? {};
  const busy = useNavigation().state !== "idle";
  const [method, setMethod] = useState("bkash");
  const [terms, setTerms] = useState(false);

  const basic = commissionFor(planPrice("Basic"), true).amount;
  const basicR = commissionFor(planPrice("Basic"), false).amount;
  const adv = commissionFor(planPrice("Advanced"), true).amount;
  const advR = commissionFor(planPrice("Advanced"), false).amount;

  return (
    <AffiliateShell
      right={
        signedIn ? (
          <a href="/affiliates/dashboard" style={shellLinkStyle}>My dashboard</a>
        ) : (
          <a href="/affiliates/login" style={shellLinkStyle}>Log in</a>
        )
      }
    >
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text as="h1" variant="heading2xl">
              Earn {Math.round(FIRST_RATE * 100)}% of the first payment, then {Math.round(RECURRING_RATE * 100)}% every month
            </Text>
            <Text as="p" variant="bodyLg">
              Refer Shopify stores to Easy SEO &amp; Meta. For every store that pays for a plan, you get{" "}
              {Math.round(FIRST_RATE * 100)}% of its first payment and {Math.round(RECURRING_RATE * 100)}% of every
              payment after that, for as long as the store keeps paying. Paid to your bKash or Nagad.
            </Text>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
              <Card background="bg-surface-secondary">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">Basic plan store ($9.99/month)</Text>
                  <Text as="p">{usd(basic)} first month, then {usd(basicR)} every month</Text>
                </BlockStack>
              </Card>
              <Card background="bg-surface-secondary">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">Advanced plan store ($24.99/month)</Text>
                  <Text as="p">{usd(adv)} first month, then {usd(advR)} every month</Text>
                </BlockStack>
              </Card>
            </InlineGrid>
            <List type="number">
              <List.Item>Sign up below. We review your application, usually within 2 business days.</List.Item>
              <List.Item>Share your link or code. Stores you refer get {REFERRAL_TRIAL_BONUS} extra free-trial days.</List.Item>
              <List.Item>In your dashboard, submit each store you referred: the store, its plan, and where and how you referred it.</List.Item>
              <List.Item>We check every store and add your commission for each payment it makes.</List.Item>
              <List.Item>
                Request a withdrawal from {usd(MIN_WITHDRAW)}. We pay it to your bKash or Nagad within{" "}
                {PAYOUT_DAYS_MIN}–{PAYOUT_DAYS_MAX} business days.
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        {!signedIn && (
          <Card>
            <Form method="post">
              <FormLayout>
                <Text as="h2" variant="headingLg">Apply to join</Text>
                {Object.keys(errors).length > 0 && <Banner tone="critical">Please fix the fields marked below.</Banner>}
                <FormLayout.Group>
                  <Field label="Full name" name="name" autoComplete="name" error={errors.name} />
                  <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
                </FormLayout.Group>
                <FormLayout.Group>
                  <Field label="Phone" name="phone" type="tel" autoComplete="tel" error={errors.phone} />
                  <Field label="Password" name="password" type="password" autoComplete="new-password" helpText="At least 8 characters" error={errors.password} />
                </FormLayout.Group>
                <FormLayout.Group>
                  <Select label="Get paid with" name="payoutMethod" options={PAYOUT_METHODS} value={method} onChange={setMethod} error={errors.payoutMethod} />
                  <Field label={`${method === "nagad" ? "Nagad" : "bKash"} number`} name="payoutNumber" type="tel" placeholder="01XXXXXXXXX" autoComplete="off" error={errors.payoutNumber} />
                  <Field label="Account name (optional)" name="payoutName" autoComplete="off" />
                </FormLayout.Group>
                <Field
                  label="Your website, Facebook page, YouTube channel or group"
                  name="website"
                  autoComplete="url"
                  placeholder="https://facebook.com/yourpage"
                  error={errors.website}
                />
                <Field
                  label="How will you promote Easy SEO & Meta?"
                  name="promotion"
                  multiline={3}
                  autoComplete="off"
                  helpText="For example: posts in Shopify seller groups, a YouTube tutorial, or recommending it to clients."
                  error={errors.promotion}
                />
                <Checkbox
                  label={
                    <span>
                      I accept the <a href="/affiliates/terms" target="_blank" rel="noreferrer">affiliate program rules</a>
                    </span>
                  }
                  name="terms"
                  checked={terms}
                  onChange={setTerms}
                  error={errors.terms}
                />
                <Button submit variant="primary" loading={busy}>
                  Apply now
                </Button>
              </FormLayout>
            </Form>
          </Card>
        )}
      </BlockStack>
    </AffiliateShell>
  );
}
