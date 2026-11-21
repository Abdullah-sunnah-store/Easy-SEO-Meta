import { useState, type ReactNode } from "react";
import { AppProvider as PolarisAppProvider, Box, InlineStack, Text, TextField, type TextFieldProps } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";

/** Standalone (non-embedded) frame for the affiliate and owner pages. */
export function AffiliateShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <div style={{ minHeight: "100vh", background: "#f1f2f4" }}>
        <div style={{ background: "#0b1f3a", color: "#fff" }}>
          <Box padding="400">
            <div style={{ maxWidth: 1040, margin: "0 auto" }}>
              <InlineStack align="space-between" blockAlign="center">
                <a href="/affiliates" style={{ color: "#fff", textDecoration: "none" }}>
                  <Text as="span" variant="headingMd">Easy SEO &amp; Meta · Affiliates</Text>
                </a>
                {right}
              </InlineStack>
            </div>
          </Box>
        </div>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 16px 48px" }}>{children}</div>
      </div>
    </PolarisAppProvider>
  );
}

export const shellLinkStyle = { color: "#fff", textDecoration: "underline", marginLeft: 16 } as const;

/** A Polaris TextField that keeps its own value, for plain form posts. */
export function Field({ defaultValue = "", ...props }: Omit<TextFieldProps, "value" | "onChange"> & { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  return <TextField {...(props as TextFieldProps)} value={value} onChange={setValue} />;
}
