# Easy SEO & Meta — সেটআপ ও রিলিজ গাইড

কোড পুরোপুরি তৈরি, টেস্ট পাস করেছে। নিচের ধাপগুলো শুধু **আপনার অ্যাকাউন্টে লগইন** লাগে বলে আপনাকে করতে হবে।
প্রতিটি কমান্ড এই ফোল্ডারে (`D:\shopify work\apps\Easy SEO`) চালাবেন।

| কোথায় লগইন | কোন অ্যাকাউন্ট | কেন |
|---|---|---|
| Shopify CLI / Partner Dashboard | nsnoman400@gmail.com (Abdullah NOMAN) | নতুন অ্যাপ তৈরি, client_id, deploy |
| GitHub | Abdullah-sunnah-store | কোড push |
| Neon (neon.tech) | আপনার Neon অ্যাকাউন্ট | ডাটাবেস |
| Vercel | আপনার Vercel অ্যাকাউন্ট | হোস্টিং |

---

## ১. প্যাকেজ ইনস্টল
```bash
npm install
```

## ২. Partner Dashboard-এ অ্যাপ তৈরি (client_id নেওয়া)
```bash
shopify auth logout
shopify auth login            # nsnoman400@gmail.com দিয়ে
shopify app config link --config scratch
```
- "Create a new app" বাছুন, নাম দিন **Easy SEO & Meta**।
- এতে `shopify.app.scratch.toml` নামে একটা ফাইল তৈরি হবে। তার ভেতরের `client_id = "..."` কপি করে
  **`shopify.app.toml`** আর **`shopify.app.production.toml`** দুই ফাইলের `REPLACE_WITH_CLIENT_ID` এর জায়গায় বসান।
- তারপর `shopify.app.scratch.toml` মুছে দিন (বাকি ফাইল আমাদেরটাই সঠিক)।
- Partner Dashboard → Apps → Easy SEO & Meta → **Client credentials** থেকে Client secret কপি করে রাখুন।

## ৩. Neon ডাটাবেস
neon.tech → New project → নাম `easy-seo` → Connection string থেকে দুটি কপি করুন:
- **Pooled** (host-এ `-pooler` থাকে) → `DATABASE_URL`
- **Direct / unpooled** → `DATABASE_URL_UNPOOLED`

## ৪. GitHub-এ push
github.com → New repository → `Abdullah-sunnah-store/easy-seo-meta` (Private) → খালি রিপো (README ছাড়া)।
```bash
git init
git add .
git commit -m "Easy SEO & Meta: first release"
git branch -M main
git remote add origin https://github.com/Abdullah-sunnah-store/easy-seo-meta.git
git push -u origin main
```

## ৫. Vercel
vercel.com → Add New → Project → `easy-seo-meta` রিপো Import।
- Project name: **easy-seo-meta** (তাহলে URL হবে `https://easy-seo-meta.vercel.app`)
- Framework: Remix (নিজে থেকে ধরবে)। Build command বদলাবেন না — `vercel-build` নিজেই migration চালায়।
- Environment Variables:

| Name | Value |
|---|---|
| SHOPIFY_API_KEY | ধাপ ২-এর client_id |
| SHOPIFY_API_SECRET | ধাপ ২-এর client secret |
| SHOPIFY_APP_URL | https://easy-seo-meta.vercel.app |
| SCOPES | read_products,write_products,read_online_store_pages,write_online_store_pages,read_online_store_navigation,write_online_store_navigation,read_files,write_files,write_app_proxy |
| DATABASE_URL | Neon pooled |
| DATABASE_URL_UNPOOLED | Neon direct |
| SHOPIFY_BILLING_TEST | true (রিভিউ পাস হলে মুছে দিন → আসল চার্জ) |

Deploy চাপুন। `https://easy-seo-meta.vercel.app/healthz` খুললে `ok` দেখাবে।

> নাম `easy-seo-meta` না পেলে Vercel অন্য URL দেবে। তখন সেই URL দিয়ে
> `shopify.app.production.toml` (সব `easy-seo-meta.vercel.app`), `SHOPIFY_APP_URL`
> এবং `scripts/dev.mjs`-এর `PRODUCTION_HOST` বদলে আবার push করবেন।

## ৬. Shopify-তে কনফিগ রিলিজ
```bash
npm run deploy
```
প্রথমে release check চলে (client_id, URL, webhook 401 ঠিক আছে কিনা)। "✓ Safe to release" না দেখালে deploy হবে না — যা লেখে সেটা ঠিক করুন।

## ৭. ডেভ স্টোরে টেস্ট
Partner Dashboard → Apps → Easy SEO & Meta → Test on development store → ইনস্টল।
1. Dashboard → **Run SEO audit**
2. Meta tags → **Fill missing** → Shopify অ্যাডমিনে প্রোডাক্টের "Search engine listing" দেখুন
3. Image alt text → Fill missing
4. Image compression → Compress (১৫০KB-এর বড় ছবি থাকতে হবে) → Restore দিয়ে ফেরত আনা যায়
5. Redirects → একটা redirect যোগ করুন; একটা প্রোডাক্ট ডিলিট করে দেখুন auto 301 হয় কিনা (Basic+)
6. llms.txt → চালু করুন → `https://<store>.myshopify.com/llms.txt`
7. Plans → Basic নিন (টেস্ট চার্জ) → সীমা উঠে যায় কিনা দেখুন

## লোকাল ডেভ (ঐচ্ছিক)
```bash
cp .env.example .env     # মান বসান
set DEV_STORE=your-dev-store.myshopify.com
npm run dev
```
`npm run dev` শেষে production URL নিজে থেকে ফিরিয়ে দেয়, তাই tunnel URL কখনো রিলিজে যায় না।

## প্ল্যান
| | Free | Basic $9.99/মাস | Advanced $24.99/মাস |
|---|---|---|---|
| SEO audit | ১০০ প্রোডাক্ট | সব প্রোডাক্ট, কালেকশন, পেজ, ব্লগ | সব |
| Meta / alt এডিট | মাসে ৫০ / ৫০ | আনলিমিটেড | আনলিমিটেড |
| Image compression | মাসে ২৫ | মাসে ১,০০০ | মাসে ৫,০০০ |
| নতুন প্রোডাক্টে auto meta/alt | — | ✓ | ✓ |
| Auto 301 (ডিলিট / handle বদল), CSV import | — | ✓ | ✓ |
| Broken link finder | — | — | ✓ |
| llms.txt, ম্যানুয়াল redirect | ✓ | ✓ | ✓ |

পেইড প্ল্যানে ৭ দিনের ফ্রি ট্রায়াল।

## টেস্ট
```bash
npm test      # লোকাল Postgres লাগে: DATABASE_URL সেট করে চালান
```
