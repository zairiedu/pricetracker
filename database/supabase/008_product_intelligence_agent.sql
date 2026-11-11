-- PricePilot Product Intelligence Agent metadata/cache migration (applied 2026-11-11)
-- Public metadata cache is readable/writable by service-role only; customers cannot overwrite cached data.
create table if not exists public.pricepilot_product_metadata_cache (
 url_hash text primary key check(length(url_hash)=64),
 hostname text not null check(length(hostname)<=255),
 extracted jsonb not null,
 extractor text not null check(extractor in ('generic_html','ai_fallback')),
 fetched_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(expires_at>fetched_at)
);
create index if not exists pricepilot_metadata_cache_expiry_idx
 on public.pricepilot_product_metadata_cache(expires_at);
alter table public.pricepilot_product_metadata_cache enable row level security;
revoke all on public.pricepilot_product_metadata_cache from anon,authenticated;
create policy pricepilot_cache_deny_clients on public.pricepilot_product_metadata_cache
 for all to anon,authenticated using(false) with check(false);

-- Server-only, strict daily AI fallback cap: 3 calls per user/day, 40 global/day.
-- The function enforces the caps before claiming the unique daily call slot.
create table if not exists public.pricepilot_ai_extraction_budget (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 url_hash text not null check(length(url_hash)=64),
 budget_day date not null default (now() at time zone 'utc')::date,
 created_at timestamptz not null default now(),
 unique(user_id,url_hash,budget_day)
);
create index if not exists pricepilot_ai_budget_user_day_idx
 on public.pricepilot_ai_extraction_budget(user_id,budget_day);
create index if not exists pricepilot_ai_budget_day_idx
 on public.pricepilot_ai_extraction_budget(budget_day);
alter table public.pricepilot_ai_extraction_budget enable row level security;
revoke all on public.pricepilot_ai_extraction_budget from anon,authenticated;
create policy pricepilot_ai_budget_deny_clients on public.pricepilot_ai_extraction_budget
 for all to anon,authenticated using(false) with check(false);

-- Product identity fields for watchlist cards.
alter table public.pricepilot_trackers
 add column if not exists product_brand text check(product_brand is null or length(product_brand)<=80),
 add column if not exists product_sku text check(product_sku is null or length(product_sku)<=80),
 add column if not exists product_description text check(product_description is null or length(product_description)<=400),
 add column if not exists product_image_url text check(product_image_url is null or length(product_image_url)<=1500);
