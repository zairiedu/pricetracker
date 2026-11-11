# PricePilot — mobile-first price tracking MVP

**Source:** https://github.com/zairiedu/pricetracker

**Live website:** https://zairiedu.github.io/pricetracker/

A responsive, no-build frontend for managing a personal product watchlist, target prices, size/color preferences, availability rules, browser notifications and conditional-buy review requests. No automatic purchases are placed.

## Quick launch

GitHub Pages is published via the GitHub Actions workflow. Open the website URL above on desktop or mobile. On your phone, choose **Add to Home Screen**. Otherwise run a local HTTP server, e.g. `python -m http.server 8080`.

The site supports **guest mode** (trackers stored in this browser) and **Supabase email/password accounts** (trackers stored in a protected cloud database with user-scoped RLS). Use **Update price** to simulate a retailer observation; browser notifications require permission and an open browser tab. No real scraping or server-side notifications happen until the backend is deployed.

## Supabase cloud accounts\n\nThis repository is connected to the existing Supabase project `pricepilot`. The live database contains an account-isolated `public.pricepilot_trackers` table with row-level SELECT/INSERT/UPDATE/DELETE policies and a database-enforced free-plan limit of five trackers per account. The browser uses **only a publishable key**, never a service-role or secret key.\n\n1. Open **Sign in → Create account** and follow the email confirmation link, if required.\n2. In [Supabase Auth URL configuration](https://supabase.com/dashboard/project/sfuoimxxzezzovqsigev/auth/url-configuration), set Site URL to `https://zairiedu.github.io/pricetracker/`, and add the same URL to allowed Redirect URLs. This admin setting is required for reliable email confirmation redirects.\n3. Sign in and add trackers. Guest trackers are kept separate by default; the **Import guest trackers** action explicitly transfers up to the remaining cloud quota.\n4. Sign out to switch back to the browser's guest watchlist.\n\nSign-in and cloud persistence rely on a pinned Supabase JavaScript module from esm.sh. Browser connectivity to that CDN and Supabase is required. This is not a multi-tenant paid production release; the reward engine currently exists as configured code and tests, not active promotions.\n\n**Important:** Existing monitoring Worker + D1 is still a separate **single-tenant demo** and does NOT use Supabase account-scoped authentication. Do not expose its shared API token to end users or claim that remote background monitoring is operational for every cloud account. Replace it with authenticated account-scoped monitoring before public scale.\n\n
## Supabase verified price checks (on-demand preview)

A connected Supabase Edge Function named `pricepilot-check` is deployed with JWT verification. Signed-in users can use **Check retailer** from a product card. This is a **manual, on-demand preview**, not an automatic monitoring scheduler.

- Allowed initial hostnames: Best Buy Canada, Walmart Canada and Canadian Tire (exact recognized hosts only); support is conditional on available JSON-LD Product/Offer metadata. Retailers may block requests or omit usable data.
- Exact requested size/color and currency must be confirmed from the available structured data; if validation fails, no observation is inserted.
- The Edge Function checks that the tracker belongs to the caller, disallows cross-host redirects and controls response size and timeout.
- Successful checks write immutable, user-owned records to `pricepilot_price_observations`; the website's **History** view displays these records.
- Server-side, idempotent-by-transition notification records are written for a new verified price match. These appear under Activity when the account reloads. Email and continuous background monitoring are **not enabled**.
- Rate budgets: one attempt per product per 15-minute window and up to 100 attempts per account in a rolling 24 hours. These are abuse/preview limits, not guaranteed monitoring frequency.
- Manual price updates are explicitly marked **unverified** and are never written to the verified observation history.
- The old Cloudflare Worker sample is legacy single-tenant demonstration code; its shared access-token interface is no longer shown in the consumer Settings page.

## Marketing configuration and entitlements

The database now contains `pricepilot_campaigns`, `pricepilot_entitlement_grants` and `pricepilot_referrals` with RLS and server-only writes. Welcome and referral examples are **drafts**. Standard allowance is five active trackers; the trigger permits qualified server-issued bonuses up to a hard cap of 500 slots. Customers cannot award themselves credits. Live coupon redemption, campaign approval, referral qualification, paid plans, and the admin console remain future work.

## Database migrations

The following SQL files document the deployed schema, in order:

1. `database/supabase/001_secure_cloud_watchlist.sql`
2. `database/supabase/002_price_history_marketing.sql`
3. `database/supabase/003_monitoring_budget.sql`

The deployed Supabase project has already received these migrations. Apply them to a **new** environment once, rather than rerunning raw SQL over live tables. A proper CLI migration-history sync is required before introducing automated staging/production migrations.

## Security and launch caveats

- Only the public Supabase publishable key is placed in `cloud.js`.
- Verified observations, marketing credits, referral records and check budgets are not customer-writable.
- Production-ready scheduled checks, paid billing, purchase integrations, consent enforcement, robust abuse defenses, and E2E signup tests are still outstanding.
- The website is static and uses a third-party pinned ESM module for Supabase client-side authentication. Move to a lockfile-managed frontend build before scaling beyond the MVP.

## Deploy optional real-monitoring backend

Cloudflare Workers + D1 provides persistent check results, a 30-minute scheduled job, and optional Resend email alerts. A Cloudflare account and optional verified email domain are needed. These resources are **not** provisioned automatically.

```bash
cd worker
npx wrangler d1 create pricepilot
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml: paste the database_id and confirm ALLOWED_ORIGIN
npx wrangler d1 execute pricepilot --remote --file=schema.sql
npx wrangler secret put API_TOKEN
# Optional email: npx wrangler secret put RESEND_API_KEY
# Optional: add ALERT_FROM = "alerts@your-verified-domain.com" to [vars]
npx wrangler deploy
```

In the website's **Settings**, enter the Worker URL, same API_TOKEN and optional alert email. Save to push local trackers; use **Sync prices** to load the latest observed prices.

**Monitoring limits:** the generic Worker parses only publicly accessible JSON-LD Product/Offer metadata. Many retailers block bots, omit metadata, render prices with JavaScript or have different prices by region. Failures remain explicit rather than inventing price data. Size and color are *saved preferences but are not verified* by the generic parser; variant-specific alerts should wait for retailer-specific adapters or official APIs. The worker rejects redirects and unsafe destination hosts. Add stricter allowlists, rate limits and abuse controls for production.

**Conditional buying:** only marks matching conditions for human review. No payments, checkout, or purchase automation is implemented. Supporting purchases safely requires an authorized retailer integration, confirmed product variant, signed-in customer consent, and a final checkout authorization step.

**Scale roadmap:** authentication/multi-tenant ownership, worker queues, retailer adapters, verified variant matching, retry/rate limits, robust emails, notification subscriptions and history dashboards. Current prototype is **single-tenant**, and anyone with its shared API token has access to all tracked products. Do not expose the token.

Do not assume this is an always-on fully operational service until Cloudflare is configured, retailer coverage is validated and alert delivery has been tested.