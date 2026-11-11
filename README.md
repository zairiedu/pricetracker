# PricePilot

Mobile-first price tracking MVP with Supabase authentication, an opt-in hourly monitoring scheduler, and configurable marketing foundations.

**Live site:** https://zairiedu.github.io/pricetracker/  
**Repo:** https://github.com/zairiedu/pricetracker

## Product URL autofill and current price (November 2026)

Sign in, open **Add tracker** (or edit an existing tracker), paste a supported product URL and click **Fetch product details**. The authenticated `pricepilot-preview` Edge Function extracts available JSON-LD product details (or a page title fallback) from an allowlisted retailer. The form suggests product name, currency, size, and color when available; you can correct them before saving. The **target price is never decided for you**.

- Product cards and the watchlist show **Current price** and **Target price** separately.
- A successfully verified exact-variant observation takes precedence and is labeled **Verified current price**.
- A page-listed price from autofill is labeled **Page price preview** and saved separately in `preview_price`/`preview_checked`; this is **not** proof of the selected size/color's actual price and never triggers verified alerts.
- A manually entered price is labeled **Manual price**. If no price is available, the current-price field is **Unknown**.
- The preview endpoint requires a signed-in account, restricts hosts and redirects, limits response size and execution time, and caps requests to 25 per account per 24 hours and one request per URL every five minutes.
- For unsupported shops or pages that hide metadata, manual entry remains available. Auto-fill is best-effort, not a general-purpose web scraper.

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
