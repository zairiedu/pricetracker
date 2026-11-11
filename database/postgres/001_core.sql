-- PricePilot PostgreSQL foundation (not yet deployed)
-- Apply with a migration runner against a private, controlled database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE account_memberships(account_id uuid NOT NULL REFERENCES accounts(id),user_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('owner','member')),PRIMARY KEY(account_id,user_id));
CREATE TABLE tracked_products(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),
 name text NOT NULL,product_url text NOT NULL,currency char(3) NOT NULL,target_amount numeric(14,2) NOT NULL CHECK(target_amount>0),
 variant_size text,variant_color text,requires_stock boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracked_products_account_status_idx ON tracked_products(account_id,status);
CREATE TABLE plan_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_key text NOT NULL,version int NOT NULL,active_slots int NOT NULL CHECK(active_slots>=0),price_minor bigint NOT NULL CHECK(price_minor>=0),currency char(3) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_key,version));
CREATE TABLE account_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),plan_version_id uuid NOT NULL REFERENCES plan_versions(id),provider_subscription_id text UNIQUE,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE campaigns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_key text NOT NULL UNIQUE,kind text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','active','paused','completed')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE campaign_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES campaigns(id),version integer NOT NULL,policy jsonb NOT NULL,published_at timestamptz,UNIQUE(campaign_id,version));
CREATE TABLE reward_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_version_id uuid NOT NULL REFERENCES campaign_versions(id),account_id uuid NOT NULL REFERENCES accounts(id),source_event_id text NOT NULL,idempotency_key text NOT NULL UNIQUE,status text NOT NULL CHECK(status IN ('pending','issued','rejected','reversed')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE entitlement_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),reward_event_id uuid UNIQUE REFERENCES reward_events(id),grant_type text NOT NULL CHECK(grant_type IN ('bonus_slots','slot_allowance_total')),quantity integer NOT NULL CHECK(quantity>0),status text NOT NULL CHECK(status IN ('active','revoked')),expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX grants_account_expiry_idx ON entitlement_grants(account_id,status,expires_at);
CREATE TABLE entitlement_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),grant_id uuid NOT NULL REFERENCES entitlement_grants(id),action text NOT NULL CHECK(action IN ('issued','expired','revoked')),idempotency_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE referrals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),referrer_account_id uuid NOT NULL REFERENCES accounts(id),referred_account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),campaign_version_id uuid REFERENCES campaign_versions(id),status text NOT NULL CHECK(status IN ('pending','qualified','rewarded','rejected')),created_at timestamptz NOT NULL DEFAULT now(),CHECK(referrer_account_id<>referred_account_id));
CREATE TABLE audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,account_id uuid REFERENCES accounts(id),event_type text NOT NULL,payload jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
-- Access control is mandatory: the API must NEVER expose unrestricted database credentials.
-- Configure tenant-specific row-level policies before connecting this schema to a public service.
