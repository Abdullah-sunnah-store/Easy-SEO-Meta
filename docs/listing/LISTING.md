# App Store জমা দেওয়ার গাইড — Easy SEO & Meta

এই ফোল্ডারে যা আছে:
- `app-icon-1200.png` — অ্যাপ আইকন (1200×1200, PNG)
- `feature-image-1600x900.png` — listing-এর উপরের বড় ছবি (1600×900)
- এই ফাইল — প্রতিটা ঘরে কী লিখবেন (ইংরেজি লেখা হুবহু কপি করবেন)

---

## Preliminary steps (App Store review পেজ)

### 1. Fix configuration → App icon
Dev Dashboard → Easy SEO & Meta → **Settings** (বা "Fix configuration") → App icon → `app-icon-1200.png` upload → Save।

### 2. Choose a primary listing language
**Choose → English** → Save।

### 3. Request access to protected customer data
অ্যাপ কোনো গ্রাহকের তথ্য ব্যবহার করে না (orders/customers scope নেই)।
**"My app won't use customer data"** টিক দিন → Save। "Request" চাপবেন না।

### 4. বাকি ধাপ
পেজে আরও নিচে কোনো ধাপ থাকলে স্ক্রিনশট পাঠান।

---

## Listing ফর্ম (Manage submission → Create listing / Edit listing)

**App name**
```
Easy SEO & Meta
```

**App icon** → `app-icon-1200.png`

**App card subtitle**
```
Fix SEO titles, meta descriptions and alt text with one click
```

**App introduction**
```
Find the SEO gaps in your store and fix them fast. AI writes meta tags and alt text in one click.
```

**App details**
```
Easy SEO & Meta audits your products, collections, pages and blog posts and shows exactly what needs fixing. Write SEO titles and meta descriptions with AI or your own templates, one item at a time or the whole catalogue in one click. AI looks at each product photo to write alt text. Compress large images with an automatic backup you can restore. Keep traffic when URLs change with automatic 301 redirects, find broken internal links, and publish an llms.txt file for AI search.
```

**Feature list**
```
SEO audit and score for products, collections, pages and blog posts
AI-written SEO titles and meta descriptions, single or bulk
AI alt text that describes each product image
Image compression with automatic backup and one-click restore
Auto 301 redirects, broken link finder and llms.txt for AI search
```

**Feature media** → `feature-image-1600x900.png`
Alt text:
```
Easy SEO & Meta writes better search listings for your store
```

**Screenshots (1600×900, অন্তত ৩টা)** — অ্যাডমিনে অ্যাপ খুলে নিজে তুলবেন। ব্রাউজার জুম ঠিক করে পুরো অ্যাপ অংশটা নেবেন:
1. Dashboard — SEO score আর issues (audit চালানোর পর)
2. Meta tags — একটা প্রোডাক্ট Edit খোলা, AI লেখা title/description আর Google preview সহ
3. Image alt text — "✨ Write all with AI" বোতাম আর ছবির তালিকা
4. Image compression — compressed তালিকা (thumbnail, Before/After)
5. Redirects & links
ছবিতে দাম, পরিসংখ্যান বা "best/first/only" জাতীয় দাবি রাখবেন না (Shopify-র নিয়ম)।


**তৈরি করা screenshots (`docs\listing\screenshots`) আর তাদের alt text (৬৪ অক্ষরের মধ্যে):**
| ফাইল | Image alt text |
|---|---|
| `1-meta-tags.png` | `Bulk SEO title and meta description editor with AI` |
| `2-alt-text.png` | `AI-written alt text for each product image` |
| `3-redirects.png` | `Automatic 301 redirects and CSV redirect import` |
| `4-redirect-list.png` | `List of all URL redirects in the store` |

**Demo store URL** (ঐচ্ছিক) — ফাঁকা রাখতে পারেন।

**Category / tags** — Store management বা Marketing-এর ভেতরে **Search engine optimization (SEO)** বেছে নিন; ট্যাগে SEO, Meta tags, Alt text, Image optimization।

**Languages** — শুধু English (অ্যাপের UI ইংরেজি)।

**Sales channel requirement** — "Merchant must have online store" টিক দিন (redirects আর llms.txt অনলাইন স্টোরে কাজ করে)।

---

## Pricing details

| Plan | Price | Trial |
|---|---|---|
| Free | Free | — |
| Basic | $9.99 / month | 7 days |
| Advanced | $24.99 / month | 7 days |

প্রতিটা প্ল্যানের বৈশিষ্ট্য (ইংরেজিতে, ফর্মে কপি করবেন):

**Free**
```
SEO audit for up to 100 products
10 AI-written titles & descriptions / month
50 template meta edits and 50 alt texts / month
25 image compressions / month
Redirect manager and llms.txt
```

**Basic**
```
Audit products, collections, pages and blog posts
300 AI writes / month
Unlimited bulk meta and alt text
1,000 image compressions / month
Auto meta for new products, auto 301s, CSV redirect import
```

**Advanced**
```
Everything in Basic
1,000 AI writes / month
5,000 image compressions / month
Broken internal link finder
Priority support
```

---

## Privacy & contact

**Privacy policy URL**
```
https://easy-seo-meta.vercel.app/privacy
```
(Vercel-এ `SUPPORT_EMAIL` ভেরিয়েবলে আপনার সাপোর্ট ইমেইল বসালে পেজে সেটা দেখাবে।)

**Support email / FAQ** — আপনার সাপোর্ট ইমেইল (নামে "Shopify" শব্দ থাকা চলবে না)।

---

## Testing instructions (রিভিউয়ারের জন্য — হুবহু কপি করুন)

```
1. Install the app and open it from the Shopify admin. No setup is needed.
2. Dashboard: click "Run SEO audit". The score and issue list appear when the scan finishes.
3. Meta tags: click "Edit" on any product, then "✨ Write both with AI". Review the text and click Save. "✨ Fix all with AI" fills every empty title/description and saves it to Shopify. "Fill missing" does the same from templates.
4. Image alt text: click "✨ AI" next to an image, or "✨ Write all with AI".
5. Image compression: click "Compress" (images over 150 KB). "Restore original" brings back the backup kept in Content → Files.
6. Redirects & links: add a redirect; delete a product to see an automatic 301 to the chosen target.
7. llms.txt: turn it on, then open https://<store>.myshopify.com/llms.txt (enter the storefront password on dev stores).
8. Plans: Basic and Advanced use Shopify billing with a 7-day trial; charges are test charges on development stores.
The app does not use customer data.
```

---

## জমা দেওয়ার আগে শেষ চেক
- Vercel থেকে `SHOPIFY_DEBUG` মুছে দিন।
- `GEMINI_API_KEY` বসানো আছে কিনা দেখুন (AI ফিচার রিভিউয়ারকে দেখাতে হবে)।
- `SHOPIFY_BILLING_TEST=true` রিভিউয়ের সময় রাখুন; পাস হলে মুছে দিন।
