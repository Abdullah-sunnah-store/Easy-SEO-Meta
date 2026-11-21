import type { MetaFunction } from "@remix-run/node";
import { BlockStack, Card, List, Text } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { AffiliateShell, shellLinkStyle } from "../components/AffiliateShell";
import {
  FIRST_RATE,
  MIN_WITHDRAW,
  PAYOUT_DAYS_MAX,
  PAYOUT_DAYS_MIN,
  RECURRING_RATE,
  REFERRAL_TRIAL_BONUS,
  usd,
} from "../lib/affiliate";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta: MetaFunction = () => [{ title: "Affiliate program rules — Easy SEO & Meta" }];

const UPDATED = "21 November 2026";

export default function AffiliateTerms() {
  const first = Math.round(FIRST_RATE * 100);
  const recurring = Math.round(RECURRING_RATE * 100);
  return (
    <AffiliateShell right={<a href="/affiliates" style={shellLinkStyle}>Back</a>}>
      <Card>
        <BlockStack gap="400">
          <Text as="h1" variant="headingXl">Affiliate program rules</Text>
          <Text as="p" tone="subdued">Easy SEO &amp; Meta · Last updated {UPDATED}</Text>

          <Text as="h2" variant="headingMd">What you earn</Text>
          <List>
            <List.Item>
              {first}% of the first payment a referred store makes for a paid plan, and {recurring}% of every payment
              after that, for as long as the store keeps paying.
            </List.Item>
            <List.Item>
              Yearly plans count as 12 months: for the first year you get {first}% of one month and {recurring}% of the
              other eleven (about 13% of the yearly price), then {recurring}% of every yearly renewal.
            </List.Item>
            <List.Item>
              Commission is worked out from the plan price the store pays. Free-trial days, free plans, development
              stores and test charges earn nothing.
            </List.Item>
            <List.Item>Payments that are refunded or reversed earn nothing, and we may deduct commission already added for them.</List.Item>
            <List.Item>Referred stores get {REFERRAL_TRIAL_BONUS} extra free-trial days when they use your link or code.</List.Item>
          </List>

          <Text as="h2" variant="headingMd">Getting credit for a store</Text>
          <List>
            <List.Item>Submit every store you referred in your dashboard, with the store address, its plan, and where and how you referred it.</List.Item>
            <List.Item>We check each store before approving it. A store counts once, for the first affiliate whose link or code the store used. When nobody's code was used, we decide from the details and proof submitted.</List.Item>
            <List.Item>Your own stores, and stores you own or manage together with others, don't count.</List.Item>
          </List>

          <Text as="h2" variant="headingMd">Getting paid</Text>
          <List>
            <List.Item>Request a withdrawal from your dashboard once your balance is at least {usd(MIN_WITHDRAW)}.</List.Item>
            <List.Item>
              We pay to the bKash or Nagad number in your dashboard within {PAYOUT_DAYS_MIN}–{PAYOUT_DAYS_MAX} business
              days, in Bangladeshi taka at the exchange rate on the day we pay. Check your number: we can't recover money
              sent to a wrong number you entered.
            </List.Item>
          </List>

          <Text as="h2" variant="headingMd">Not allowed</Text>
          <List>
            <List.Item>Offering anything (money, discounts, gifts) in return for app reviews or ratings, or asking for reviews on our behalf.</List.Item>
            <List.Item>False or exaggerated claims, such as guaranteed Google rankings or traffic.</List.Item>
            <List.Item>Spam: unsolicited bulk messages, or posting where a group's rules don't allow it.</List.Item>
            <List.Item>Using &quot;Shopify&quot; in a way that suggests you are Shopify or speak for it, or paid ads on our brand name.</List.Item>
            <List.Item>Fake stores, fake installs, or submitting stores you didn't refer.</List.Item>
          </List>
          <Text as="p">
            We may reject referrals, hold payments while we investigate, or close an account that breaks these rules.
            We may change the program, including commission rates, with notice in the dashboard; commission already added
            stays yours.
          </Text>
        </BlockStack>
      </Card>
    </AffiliateShell>
  );
}
