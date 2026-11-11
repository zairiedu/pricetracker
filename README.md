# PricePilot — mobile-first price tracking MVP

**Source:** https://github.com/zairiedu/pricetracker

**Live website:** https://zairiedu.github.io/pricetracker/

A responsive, no-build frontend for managing a personal product watchlist, target prices, size/color preferences, availability rules, browser notifications and conditional-buy review requests. No automatic purchases are placed.

## Quick launch

GitHub Pages is published via the GitHub Actions workflow. Open the website URL above on desktop or mobile. On your phone, choose **Add to Home Screen**. Otherwise run a local HTTP server, e.g. `python -m http.server 8080`.

The site supports **guest mode** (trackers stored in this browser) and **Supabase email/password accounts** (trackers stored in a protected cloud database with user-scoped RLS). Use **Update price** to simulate a retailer observation; browser notifications require permission and an open browser tab. No real scraping or server-side notifications happen until the backend is deployed.

## Supabase cloud accounts\n\nThis repository is connected to the existing Supabase project `pricepilot`. The live database contains an account-isolated `public.pricepilot_trackers` table with row-level SELECT/INSERT/UPDATE/DELETE policies and a database-enforced free-plan limit of five trackers per account. The browser uses **only a publishable key**, never a service-role or secret key.\n\n1. Open **Sign in → Create account** and follow the email confirmation link, if required.\n2. In [Supabase Auth URL configuration](https://supabase.com/dashboard/project/sfuoimxxzezzovqsigev/auth/url-configuration), set Site URL to `https://zairiedu.github.io/pricetracker/`, and add the same URL to allowed Redirect URLs. This admin setting is required for reliable email confirmation redirects.\n3. Sign in and add trackers. Guest trackers are kept separate by default; the **Import guest trackers** action explicitly transfers up to the remaining cloud quota.\n4. Sign out to switch back to the browser's guest watchlist.\n\nSign-in and cloud persistence rely on a pinned Supabase JavaScript module from esm.sh. Browser connectivity to that CDN and Supabase is required. This is not a multi-tenant paid production release; the reward engine currently exists as configured code and tests, not active promotions.\n\n**Important:** Existing monitoring Worker + D1 is still a separate **single-tenant demo** and does NOT use Supabase account-scoped authentication. Do not expose its shared API token to end users or claim that remote background monitoring is operational for every cloud account. Replace it with authenticated account-scoped monitoring before public scale.\n\n## Deploy optional real-monitoring backend

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