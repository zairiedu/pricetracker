-- PricePilot Supabase migration 003 — backend-only monitoring request budgets.
-- Applied on 2026-11-11; may be rerun on a fresh staging database.
create table if not exists public.pricepilot_check_attempts (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 tracker_id uuid not null references public.pricepilot_trackers(id) on delete cascade,
 window_slot bigint not null,
 created_at timestamptz not null default now(),
 unique(user_id,tracker_id,window_slot)
);
create index if not exists pricepilot_attempts_budget_idx on public.pricepilot_check_attempts(user_id,created_at desc);
alter table public.pricepilot_check_attempts enable row level security;
revoke all on public.pricepilot_check_attempts from anon,authenticated;
create policy pricepilot_attempts_deny_client_access on public.pricepilot_check_attempts
 for all to anon,authenticated using (false) with check (false);
-- Service role only; Edge Function separately authenticates and validates ownership.
