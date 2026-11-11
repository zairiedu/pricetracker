-- PricePilot: store an informational page-price preview separately from trusted observation history.
-- Applied to the connected Supabase project on 2026-11-11.
-- Values in this table are customer-editable, so never use them for verified alerts or buying.
alter table public.pricepilot_trackers
 add column if not exists preview_price numeric(12,2) check(preview_price is null or preview_price>=0),
 add column if not exists preview_checked timestamptz;
create table if not exists public.pricepilot_product_previews (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 url_hash text not null check(length(url_hash)=64),
 window_slot bigint not null,
 created_at timestamptz not null default now(),
 unique(user_id,url_hash,window_slot)
);
create index if not exists pricepilot_previews_budget_idx on public.pricepilot_product_previews(user_id,created_at desc);
alter table public.pricepilot_product_previews enable row level security;
revoke all on public.pricepilot_product_previews from anon,authenticated;
create policy pricepilot_previews_deny_clients on public.pricepilot_product_previews for all to anon,authenticated using(false) with check(false);
