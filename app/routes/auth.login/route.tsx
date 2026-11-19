import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";
import { embeddedAppUrl, isEmbeddedRequest } from "../../lib/embedded.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Inside the Shopify admin there is nothing to log in to: the app signs in
  // with Shopify's session token. Send the request back into the app when the
  // shop can be recovered, and never show the shop-domain form in the admin.
  const resume = embeddedAppUrl(request);
  if (resume) throw redirect(resume);
  if (isEmbeddedRequest(request)) {
    return { embedded: true, errors: {} as Record<string, string>, polarisTranslations };
  }

  const errors = loginErrorMessage(await login(request));

  return { embedded: false, errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  if (loaderData.embedded) {
    return (
      <PolarisAppProvider i18n={loaderData.polarisTranslations}>
        <Page>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                Reopen Easy SEO &amp; Meta
              </Text>
              <Text as="p">
                Easy SEO &amp; Meta signs you in with your Shopify account, so there is no separate
                login. This page lost track of your store — open the app again from{" "}
                <strong>Apps → Easy SEO &amp; Meta</strong> in your Shopify admin.
              </Text>
              <div>
                <Button url="https://admin.shopify.com/" target="_top">
                  Go to Shopify admin
                </Button>
              </div>
            </BlockStack>
          </Card>
        </Page>
      </PolarisAppProvider>
    );
  }

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={(errors as Record<string, string | undefined>).shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
