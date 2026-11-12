# PricePilot

## Crawl4AI browser-rendering fallback (November 2026)

An optional **open-source Crawl4AI** browser worker is now integrated into the
deployed `pricepilot-preview` Supabase Edge Function (v10). Direct HTML/JSON-LD
parsing remains the default. When direct retrieval fails or provides no page
price/name, the function can request rendered HTML from the private worker, then
parse the result with the existing shared parser. This avoids using AI to invent
price or stock data and preserves the same preview-rate limits.

Code and deployment instructions: [services/product-renderer](services/product-renderer/README.md).
To activate, deploy the Docker worker with private HTTPS access and filtered
network egress, then configure the private Supabase secrets
`PRICEPILOT_RENDERER_URL` and `PRICEPILOT_RENDERER_TOKEN`.
**The fallback is not active until that service is hosted and those secrets
are configured.** No extra hosting has been purchased or provisioned. The
existing extraction flow remains active and available.

Mobile-first price tracking MVP with Supabase authentication, an opt-in hourly monitoring scheduler, and configurable marketing foundations.

**Live site:** https://zairiedu.github.io/pricetracker/  
**Repo:** https://github.com/zairiedu/pricetracker

## Retailer-independent product autofill (November 2026)

**Product detail autofill now accepts any public HTTPS retailer hostname** (not a predefined store allowlist). Sign-in is required. PricePilot attempts generic JSON-LD/Open Graph/HTML parsing, optionally supplements missing identity information through a configured AI fallback, and caches page data. Examples of supported page structures include Canadian Tire, DSW, and Shopify/WooCommerce-style pages. These are **best-effort** previews, not guaranteed live product data.

### Security and operational limits

- Reject IP-literal, local/internal, metadata, dynamic-local-DNS, non-HTTPS, credentialed and nonstandard-port URLs. Check public DNS answers before fetching. Never follow redirects. Bound time and HTML response size.
- DNS preflighting is defense in depth, not a DNS-pinned outbound connection. **DNS rebinding remains possible** in this edge implementation; before public scale, route arbitrary URL retrieval through a hardened egress proxy that validates the actual connected IP address.
- Keep authentication and the 25 uncached product previews/day/user budget and 5-minute same-URL cooldown. Shared cache helps avoid repeated retailer requests.
- Retailer blocks, bot challenges, JavaScript-only product pages, local-store pricing, missing currency, variant-specific pricing or a page refusing remote access can prevent successful extraction. Do not bypass access controls; use official retailer feeds/APIs or authorized browser rendering services if needed.
- The broader arbitrary-host support applies only to **product details and unverified page-price previews**, **not** to automatic, verified price checks or purchasing. Scheduled monitoring stays restricted to its separately supported integrations.

## DSW Canada preview support

DSW Canada (`dsw.ca` / `www.dsw.ca`) is allowed for **product metadata previews** from the authenticated `pricepilot-preview` function. The tested fixture URL is:

`https://www.dsw.ca/product/elements-youth-boys-waterproof-tech-winter-boot/863101507?activeColor=120`

The published DSW page identifies an Elements Youth Boy's Waterproof Tech Winter Boot, item 863101507, black, with a displayed $59.97 CAD clearance price when checked on November 11, 2026. Stock cannot be confirmed without selecting a shoe size. An automated Deno fixture verifies correct product selection, price/currency only when included in structured data, and no contamination by recommended products.

**Important:** DSW is **not yet enabled for verified background price monitoring**. PricePilot's preview service may report no price if DSW's server-side HTML lacks consistent structured data. Page prices remain unverified until exact size, color and availability can be independently confirmed. The app has not yet completed an authenticated live extraction test for this DSW URL.

## Product Intelligence Agent (hybrid extractor)

The live `pricepilot-preview` Supabase Edge Function uses **generic HTML parsing first**, followed by a small AI fallback **only if explicitly enabled**. It never trusts AI-generated prices or stock as verified evidence.

1. Parse JSON-LD Product/Offer, Open Graph metadata, product image, SKU, brand, size and color with `node-html-parser`.
2. For matching allowlisted URLs, reuse a protected shared cache: 15 minutes for page-price previews, 24 hours for metadata-only results.
3. If meaningful product identity is still missing, optionally use `supabase/functions/pricepilot-preview/agent.ts`, which sends bounded untrusted page text to a hosted OpenAI model using Structured Outputs. Only identity fields (name, brand, description, size, color, SKU, image) can be supplemented. Prices, checkout and verified alerts are **not** AI-derived.
4. Budget safeguards reserve at most **3 AI calls per user per UTC day**, **40 overall per day**, and **1 per URL/user/day**. Standard requests remain limited to 25 uncached previews per user per rolling day, with a 5-minute URL cooldown.
5. Output includes provenance and cached status. The page price remains labeled **Page price preview**, not verified current price.

### AI fallback configuration

**Default:** disabled, with zero AI API charges. To enable later, set private Edge Function secrets in Supabase (never in GitHub or the browser):

```text
PRICEPILOT_AI_ENABLED=true
OPENAI_API_KEY=<private API key>
PRICEPILOT_AI_MODEL=gpt-4o-mini
```

Only enable after selecting a funded API account with an explicit spending ceiling. The Supabase function calls the OpenAI Responses API using `store: false`. OpenAI API billing is separate from ChatGPT subscriptions. The model does not browse the web; it receives limited text already retrieved from an allowlisted retailer page.

**Limits:** No generic scraper or agent can guarantee prices from JavaScript-only or access-restricted retailers. It never bypasses retailer blocks, invents currencies, or creates confirmed price observations when the requested variant is unclear. The supplied Canadian Tire treadmill is covered by representative automated extraction fixtures, but real live-store extraction still needs to be tested with an authenticated user.

## Product URL autofill and current price (November 2026)

Sign in, open **Add tracker** (or edit an existing tracker), paste a supported product URL and click **Fetch product details**. The authenticated `pricepilot-preview` Edge Function extracts available JSON-LD product details (or a page title fallback) from an allowlisted retailer. The form suggests product name, currency, size, and color when available; you can correct them before saving. The **target price is never decided for you**.

- Product cards and the watchlist show **Current price** and **Target price** separately.
- A successfully verified exact-variant observation takes precedence and is labeled **Verified current price**.
- A page-listed price from autofill is labeled **Page price preview** and saved separately in `preview_price`/`preview_checked`; this is **not** proof of the selected size/color's actual price and never triggers verified alerts.
- A manually entered price is labeled **Manual price**. If no price is available, the current-price field is **Unknown**.
- The preview endpoint requires a signed-in account, rejects nonpublic or unsafe hosts and redirects, limits response size and execution time, and caps requests to 25 per account per 24 hours and one request per URL every five minutes.
- For inaccessible shops or pages that hide metadata, manual entry remains available. Auto-fill is best-effort, not a general-purpose web scraper.

## Generic product extraction (November 2026)

PricePilot now uses the pinned [node-html-parser](https://www.npmjs.com/package/node-html-parser) package in the Supabase `pricepilot-preview` Edge Function. It extracts product metadata using a reusable pipeline rather than hardcoded CSS selectors for each retailer:

1. Schema.org JSON-LD `Product` and `Offer`, matched to the requested page by URL, product identifiers, and title; ambiguous product recommendations are ignored.
2. Product-specific Open Graph or itemprop price/currency metadata when present.
3. Open Graph/Twitter title and image, then the page title and main heading as a descriptive fallback.
4. Brand, SKU, color, size, description, and image when the page provides them; unknown fields remain empty.

The add/edit form shows a thumbnail and identifies the extraction source. Account watchlists persist optional `product_brand`, `product_sku`, `product_description`, and `product_image_url`. A page-listed price is **always an unverified preview**, not a trusted exact-variant observation or alert trigger.

This is an incremental improvement, **not universal retailer coverage**. Sites that require browser JavaScript rendering or deny server-side access may still return partial metadata. The scalable fallback should use retailer-authorized APIs or a browser-rendering worker (such as Crawlee/Playwright), subject to retailer rules, quotas and costs. The installed `node-html-parser` package parses HTML but cannot execute JavaScript.

Test target: `https://www.canadiantire.ca/en/pdp/horizon-fitness-7-0at-folding-treadmill-1840987p.html`. Canadian Tire's product page exposes a treadmill title and an advertised page price, but extraction from Supabase has not yet been validated with a signed-in customer JWT. Regional store prices and availability must never be guessed.

## What works

- Calm sage/cream responsive dashboard, mobile bottom navigation, product watchlists, size/color/price rules.
- Email/password Supabase authentication and account-isolated watchlist persistence, including explicit guest-data import.
- Product cards with **Check retailer**, verified price history and saved notification inbox; manually entered prices are clearly unverified.
- **Opt-in automatic monitoring** per product for signed-in users. The hourly Supabase Cron job only checks trackers with `monitoring_enabled=true`, respecting their configured interval (default 24 hours).
- Best Buy Canada, Walmart Canada, Canadian Tire and Sport Chek have an *experimental* allowlist; being listed does not guarantee that price metadata is available. Exact size/color/currency must match structured Product/Offer metadata or no price will be recorded.
- Each verified match can create an in-app notification. Notifications can be marked as read.
- Database-enforced tracking quota (default five); draft welcome/referral campaigns and grant accounting are present, but **no live referral awards or paid subscriptions**.

### Enable background monitoring

1. Open the [live site](https://zairiedu.github.io/pricetracker/) and sign in.
2. Find your saved product under **Overview**.
3. Click **Enable automatic checks** and accept the confirmation. This is off by default.
4. The hourly worker runs at 7 minutes after each UTC hour; when a product is due it attempts to retrieve permissible public metadata, at most once every 24 hours by default. There is no guarantee of a successful price result.
5. Review the product's latest check result and **History**. Confirmed matches appear in **Alerts**.

The worker is bounded to 10 attempts per execution, 100 attempts per user per rolling 24 hours, and a 15-minute per-product deduplication window. It does not attempt checkout. The in-app notification inbox is not email or native push delivery.

The hourly cron job `pricepilot-sweep-hourly` is active in Supabase. It calls Edge Function `pricepilot-sweep` using a random scheduler credential stored in Supabase Vault. The function uses server-side validation of this credential; public callers cannot trigger a sweep. The authenticated manual check endpoint is `pricepilot-check`. Both functions are versioned in `supabase/functions/`.

**Monitoring accuracy warning:** retailer sites can block requests or omit machine-readable variants. Failed or uncertain checks leave the price unverified and record the failure status. Do not treat price/availability matches as purchase guarantees. A production retailer connector program will require explicit retailer agreements/APIs where applicable.

## Architecture

- `index.html` — dependency-light static web UI.
- `cloud.js` — Supabase Auth and user-scoped watchlist, history, alerts and monitoring toggle; uses a public **publishable** key only.
- `supabase/functions/pricepilot-check/` — authenticated, rate-limited, user-triggered retailer check.
- `supabase/functions/pricepilot-sweep/` — Vault-authenticated scheduled backend monitoring.
- `database/supabase/` — numbered SQL snapshots of applied migrations and scheduler setup.
- `config/launch-marketing.json` — proposed plans and **draft** marketing campaigns.
- `packages/rules/marketing.mjs` — testable entitlement and campaign policy functions.
- `tests/` — Node tests of marketing rules and frontend expectations.
- `.github/workflows/` — CI and GitHub Pages deployment, restricted to public site files.

### Security

Supabase RLS enforces account ownership of trackers, observations, notifications and rewards. Clients cannot write verified observations, grants or monitoring logs; account linkage uses composite foreign keys for defense in depth. The scheduler token stays in Vault and is never included in the repository.

The following items are **not** yet production-ready: paid plans and billing, campaign administration, referral qualification and reward issuance, reliable coverage of more retailers, outbound email/push notifications, automated checkout, comprehensive E2E browser tests, full privacy/consent controls, and advanced abuse/monitoring budgets.

Authentication site/redirect URL for the connected Supabase project should be set to `https://zairiedu.github.io/pricetracker/`.

## Database history

Migration snapshots in `database/supabase/`:

1. `001_secure_cloud_watchlist.sql`
2. `002_price_history_marketing.sql`
3. `003_monitoring_budget.sql`
4. `004_cross_table_ownership.sql`
5. `005_automatic_monitoring.sql`
6. `006_performance_indexes.sql`
7. `007_product_autofill.sql`
8. `008_product_intelligence_agent.sql`

These have been applied to the current Supabase project. Some snapshots are intended as **one-time new-environment migrations**, not scripts to rerun in production. Project Vault's `pricepilot_sweep_public_key` is configured separately from the random scheduler credential. Avoid committing secret key values. A proper Supabase migration-history reconciliation and local staging flow remain future work.

## Development

Requirements: Node 22+ for tests.

```bash
npm test
npm run check
python -m http.server 8080
```

The old `worker/` Cloudflare + D1 sample is retained only for historical reference and is **not** the active multiuser monitoring backend. Its shared token must never be published or reused for authenticated customers.

## Supabase Auth security note

The latest Supabase advisor still recommends enabling leaked-password protection in the project's Auth password-security settings; that administrator setting is not changed by this repository.

Do not mistake a successful GitHub Pages publish or an active Edge Function for end-to-end verified merchant pricing. The first real retailer observation and outbound alert still need live-store and customer-account validation.
