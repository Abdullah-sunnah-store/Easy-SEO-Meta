import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import { BlockStack, Button, Card, InlineStack, Text, TextField } from "@shopify/polaris";

type Result = { ok: boolean; error?: string };

/** Home card: enter an affiliate's referral code for extra free-trial days. */
export function ReferralCodeCard({ applied, bonusDays }: { applied: string; bonusDays: number }) {
  const fetcher = useFetcher<Result>();
  const revalidator = useRevalidator();
  const [code, setCode] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) revalidator.revalidate();
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (applied) {
    return (
      <Card>
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Referral code {applied} applied</Text>
          <Text as="p" tone="subdued">
            Paid plans start with {bonusDays} extra free-trial days.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Have a referral code?</Text>
          <Text as="p" tone="subdued">Enter it to get {bonusDays} extra free-trial days on any paid plan.</Text>
        </BlockStack>
        <fetcher.Form method="post" action="/app/referral">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <div style={{ flex: 1, maxWidth: 280 }}>
              <TextField
                label="Referral code"
                labelHidden
                name="code"
                value={code}
                onChange={(v) => setCode(v.toUpperCase())}
                autoComplete="off"
                placeholder="e.g. RAHIM"
                error={fetcher.data && !fetcher.data.ok ? fetcher.data.error : undefined}
              />
            </div>
            <Button submit loading={busy} disabled={!code.trim()}>
              Apply
            </Button>
          </InlineStack>
        </fetcher.Form>
      </BlockStack>
    </Card>
  );
}
