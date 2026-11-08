import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Easy SEO &amp; Meta</h1>
        <p className={styles.text}>
          Find and fix what keeps your Shopify store out of search results — meta tags, image alt text, heavy images,
          broken links and redirects — in bulk.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>SEO audit and score</strong>. Every product, collection, page and blog post checked for missing or
            overlong titles and descriptions, missing alt text, duplicates and thin content.
          </li>
          <li>
            <strong>Bulk meta tags and alt text</strong>. Write them one by one with a Google preview, or fill every gap
            at once from templates.
          </li>
          <li>
            <strong>Redirects, broken links, llms.txt and image compression</strong>. Keep old URLs ranking, fix links to
            deleted pages, describe your store to AI search, and shrink oversized images with a backup of every original.
          </li>
        </ul>
      </div>
    </div>
  );
}
