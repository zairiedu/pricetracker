# PricePilot implementation milestones

## Completed in this iteration
- Calm & Optimistic mobile-first theme (sage / cream / sky blue), desktop sidebar and mobile bottom navigation.
- Configurable launch marketing seed data in `config/launch-marketing.json` (campaigns remain DRAFT).
- Pure marketing and entitlement rules with Node unit tests.
- Initial PostgreSQL schema for accounts, watchlists, plans, campaigns, referral rewards and immutable ledger records.

## Not yet enabled
- User sign-in and session lifecycle. The public website still stores demo watches in browser localStorage.
- Customer-specific row-level authorization. The initial SQL schema MUST NOT be made publicly accessible before RLS policies and authenticated APIs are built.
- Live PostgreSQL hosting and migration deployment.
- Paid billing, real campaigns, or referral awards.
- Complete retailer-specific price/variant verification and fully automatic purchasing.

## Deployment prerequisites
1. User connects a managed database and authentication provider (e.g. Supabase); configure project URL and publishable key, never a service-role key in frontend.
2. Choose permitted monitoring sources / retailer integrations.
3. Provision worker secrets, authenticated APIs and rate limits.
4. Configure verified sender domain to deliver production email notifications.
5. Set feature flags and test tenant isolation and reward idempotency before allowing external signups.

## Sequencing
1. Set up auth, tenant scoping and migration tooling in a staging environment.
2. Store watched products in account-scoped tables; migrate demo local watches only with explicit user action.
3. Deploy permitted retailer adapters + persisted price observations and notifications.
4. Implement server-side campaign lifecycle, transactional reward issuance, redemption caps and admin approval.
5. Integrate recurring billing and test webhook reconciliation.
6. Expand into assisted checkout only with retailer authorization.

## QA checklist
- CI runs `node --check worker/index.js` and `node --test tests/*.test.mjs`.
- Check mobile navigation at 320px and 390px widths.
- Verify tracking slots are not silently additive for welcome campaigns.
- Check that duplicate reward events share an idempotency key.
- Verify no credentials committed; campaigns default to `draft`.
