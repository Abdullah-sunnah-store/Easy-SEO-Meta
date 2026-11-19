# App Store review 149683 — what to paste

## Testing instructions (Partner Dashboard → listing → "Testing instructions")

Easy SEO & Meta has no separate account or password. It signs in with the
merchant's Shopify account through Shopify's session tokens, so no test
credentials are needed.

1. Install the app on any development store and open it from Apps → Easy SEO & Meta.
2. On Home, click "Run an audit". It scans products, collections, pages and blog posts.
3. Meta tags: click Edit on any row, change the SEO title / meta description, Save.
4. Image alt text, Image compression, Redirects & links, Speed test and llms.txt are in the app menu.
5. Plans: paid plans use Shopify billing; the review store can approve them as test charges.

## 4.5.4 Include test credentials — reply

The app has no login of its own; it authenticates with Shopify session tokens,
so there are no credentials to provide. The "Shop domain" form you saw was the
app's fallback page, shown when the embedded request arrived without the shop
parameter. We fixed it: inside the Shopify admin the app now recovers the
store from the `host` parameter and continues straight into the app, and the
shop-domain form is never shown in the admin. Testing instructions are updated.

## 2.1.4 Synchronize data accurately — reply

Fixed. The Meta tags and Image alt text pages now re-read every listed
product, collection, page and blog post from Shopify each time they load, so a
renamed product (or SEO fields / alt text edited in the Shopify admin) shows
its current values immediately. The products/update webhook also updates the
app's stored copy as soon as a product changes, and items deleted in Shopify
are removed from the app.

## Proof of resolution

Record a short screen video (Loom etc.) for each and paste the link:
- 4.5.4: open the app from Apps in a fresh dev store → it loads straight to Home.
- 2.1.4: rename a product in Shopify → open Meta tags → the new name shows.
