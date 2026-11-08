import { Banner, Text } from "@shopify/polaris";
import { Link } from "@remix-run/react";
import type { PlanName } from "../lib/plans";

/**
 * Shown above a feature the current plan doesn't include. The controls beneath
 * it are also disabled, and the matching route action rejects the write — this
 * banner is the explanation, not the enforcement.
 */
export function UpgradeNotice({ required }: { required: PlanName }) {
  return (
    <Banner tone="info">
      <Text as="p" variant="bodyMd">
        Available on the <b>{required}</b> plan.{" "}
        <Link to="/app/plans">View plans</Link>
      </Text>
    </Banner>
  );
}
