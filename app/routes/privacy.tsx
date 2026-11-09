import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

// Public privacy policy, linked from the Shopify App Store listing:
//   https://<app host>/privacy
// SUPPORT_EMAIL on the host sets the contact address shown here.

export const meta: MetaFunction = () => [
  { title: "Privacy policy — Easy SEO & Meta" },
  { name: "description", content: "How the Easy SEO & Meta Shopify app handles store data." },
];

export const loader = async (_args: LoaderFunctionArgs) => ({
  email: process.env.SUPPORT_EMAIL?.trim() || "",
});

const UPDATED = "9 November 2026";

export default function Privacy() {
  const { email } = useLoaderData<typeof loader>();
  const contact = email ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    "the contact details on our Shopify App Store listing"
  );
  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>Privacy policy</h1>
      <p style={styles.muted}>Easy SEO &amp; Meta · Last updated {UPDATED}</p>

      <p>
        Easy SEO &amp; Meta (&quot;the app&quot;) helps Shopify merchants improve their store&apos;s search
        listings. This policy explains what store data the app reads, why, where it is kept and how it is
        deleted. The app does not collect or store personal information about your customers.
      </p>

      <h2 style={styles.h2}>What the app accesses</h2>
      <ul>
        <li>Your shop&apos;s domain, name and the access token Shopify issues when you install the app.</li>
        <li>
          Catalogue content: product, collection, page and blog post titles, descriptions, handles, SEO titles and
          meta descriptions, vendors, product types, tags and prices.
        </li>
        <li>Product image URLs, file sizes and alt text, and the image files themselves when you compress them.</li>
        <li>URL redirects in your online store.</li>
        <li>Your app settings, plan, and monthly usage counts (for example, how many images were compressed).</li>
      </ul>
      <p>
        The app does not request access to orders or customers. The privacy webhooks Shopify sends for customer
        data are answered, but there is no customer data in the app to export or delete.
      </p>

      <h2 style={styles.h2}>How it is used</h2>
      <ul>
        <li>To run the SEO audit and show you missing or weak titles, descriptions, alt text and broken links.</li>
        <li>To write SEO titles, meta descriptions, alt text and redirects to your store when you ask it to.</li>
        <li>To compress product images, keeping the original in your Shopify Files so you can restore it.</li>
        <li>To publish an llms.txt file for your store when you turn that on.</li>
        <li>To bill your plan through Shopify and enforce plan limits.</li>
      </ul>

      <h2 style={styles.h2}>AI writing</h2>
      <p>
        When you use an AI writing feature, the app sends the relevant item&apos;s public catalogue text (title,
        description, vendor, type, tags, price) or the product image to Google&apos;s Gemini API to generate the
        text. Nothing about your customers is sent. Google processes this data under its own terms and may use it to
        improve its services. AI features only run when you click an AI button or turn on AI for new products.
      </p>

      <h2 style={styles.h2}>Where data is stored</h2>
      <p>
        Data is stored in a PostgreSQL database hosted by Neon and the app runs on Vercel, both in the United
        States. Connections are encrypted. Changes the app makes to your catalogue are stored in Shopify itself.
      </p>

      <h2 style={styles.h2}>Sharing</h2>
      <p>
        We do not sell or rent store data. It is shared only with the service providers named above (Shopify,
        Vercel, Neon and, for AI features, Google) to operate the app.
      </p>

      <h2 style={styles.h2}>Retention and deletion</h2>
      <p>
        When you uninstall the app its access to your store ends immediately. Shopify then sends a request to erase
        your shop&apos;s data, and the app deletes everything it stored about your shop when it receives that request
        (normally 48 hours after uninstalling). SEO fields, alt text, redirects and compressed images already written
        to your store stay in Shopify.
      </p>

      <h2 style={styles.h2}>Your choices</h2>
      <p>
        You can change or undo any edit in Shopify at any time, restore compressed images from the app, and request a
        copy or deletion of your shop&apos;s data by contacting us.
      </p>

      <h2 style={styles.h2}>Contact</h2>
      <p>Questions about this policy: {contact}.</p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "48px 20px 80px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    lineHeight: 1.6,
    color: "#1f2328",
  },
  h1: { fontSize: 32, marginBottom: 4 },
  h2: { fontSize: 20, marginTop: 32 },
  muted: { color: "#59636e", marginTop: 0 },
};
