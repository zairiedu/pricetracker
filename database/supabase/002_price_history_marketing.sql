-- PricePilot Supabase migration 002
-- Applied to connected Supabase project on 2026-11-11.
-- Managed/admin writes only for verified observations, campaigns, grants, referrals.
-- Safe to apply once to an empty extension of migration 001.
create table public.pricepilot_price_observations (
 id bigint generated always as identity primary key,
 tracker_id uuid not null references public.pricepilot_trackers(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 amount numeric(12,2) not null check(amount>=0),
 currency text not null check(currency in ('CAD','USD','EUR','GBP')),
 available boolean,source text not null check(source in ('retailer_jsonld')),
 observed_at timestamptz not null default now()
);
create index pricepilot_price_history_idx on public.pricepilot_price_observations(tracker_id,observed_at desc);
alter table public.pricepilot_price_observations enable row level security;
revoke all on public.pricepilot_price_observations from anon,authenticated;
grant select on public.pricepilot_price_observations to authenticated;
create policy pricepilot_observations_select_own on public.pricepilot_price_observations
 for select to authenticated using ((select auth.uid())=user_id);

create table public.pricepilot_notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 tracker_id uuid references public.pricepilot_trackers(id) on delete cascade,
 kind text not null check(kind in ('target_price','availability')),
 message text not null check(length(message)<=500),
 source_observation_id bigint references public.pricepilot_price_observations(id) on delete cascade,
 created_at timestamptz not null default now(),read_at timestamptz,
 unique(tracker_id,kind,source_observation_id)
);
create index pricepilot_notifications_user_time_idx on public.pricepilot_notifications(user_id,created_at desc);
alter table public.pricepilot_notifications enable row level security;
revoke all on public.pricepilot_notifications from anon,authenticated;
grant select,update(read_at) on public.pricepilot_notifications to authenticated;
create policy pricepilot_notifications_select_own on public.pricepilot_notifications
 for select to authenticated using ((select auth.uid())=user_id);
create policy pricepilot_notifications_mark_read on public.pricepilot_notifications
 for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create table public.pricepilot_campaigns (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code ~ '^[a-z0-9_-]+$'),
 category text not null check(category in ('welcome','referral','coupon','retention')),
 status text not null default 'draft' check(status in ('draft','scheduled','active','paused','ended')),
 rules jsonb not null default '{}'::jsonb,
 starts_at timestamptz,ends_at timestamptz,
 max_redemptions integer check(max_redemptions is null or max_redemptions>=0),
 created_at timestamptz not null default now()
);
alter table public.pricepilot_campaigns enable row level security;
revoke all on public.pricepilot_campaigns from anon,authenticated;
grant select on public.pricepilot_campaigns to authenticated;
create policy pricepilot_campaigns_active_read on public.pricepilot_campaigns
 for select to authenticated using(status='active' and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()));

create table public.pricepilot_entitlement_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 campaign_id uuid references public.pricepilot_campaigns(id),
 grant_kind text not null check(grant_kind in ('bonus_slots','slot_allowance_total')),
 quantity integer not null check(quantity>0),
 grant_status text not null default 'active' check(grant_status in ('active','revoked')),
 source_key text not null unique,expires_at timestamptz,created_at timestamptz not null default now()
);
create index pricepilot_grants_user_idx on public.pricepilot_entitlement_grants(user_id,expires_at);
alter table public.pricepilot_entitlement_grants enable row level security;
revoke all on public.pricepilot_entitlement_grants from anon,authenticated;
grant select on public.pricepilot_entitlement_grants to authenticated;
create policy pricepilot_grants_select_own on public.pricepilot_entitlement_grants
 for select to authenticated using((select auth.uid())=user_id);

create table public.pricepilot_referrals (
 id uuid primary key default gen_random_uuid(),
 referrer_user_id uuid not null references auth.users(id) on delete cascade,
 referred_user_id uuid not null unique references auth.users(id) on delete cascade,
 campaign_id uuid references public.pricepilot_campaigns(id),
 state text not null default 'pending' check(state in ('pending','qualified','rewarded','rejected')),
 created_at timestamptz not null default now(),qualified_at timestamptz,
 check(referrer_user_id<>referred_user_id)
);
alter table public.pricepilot_referrals enable row level security;
revoke all on public.pricepilot_referrals from anon,authenticated;
grant select on public.pricepilot_referrals to authenticated;
create policy pricepilot_referrals_own on public.pricepilot_referrals
 for select to authenticated using((select auth.uid())=referrer_user_id or (select auth.uid())=referred_user_id);

insert into public.pricepilot_campaigns(code,category,status,rules,max_redemptions) values
 ('welcome-20','welcome','draft','{"grant_kind":"slot_allowance_total","quantity":20,"expires_days":30,"new_users_only":true}'::jsonb,1000),
 ('refer-20','referral','draft','{"grant_kind":"bonus_slots","quantity":20,"expires_days":90,"qualified_days":7,"per_referrer_cap":10}'::jsonb,2000)
on conflict (code) do nothing;

create or replace function public.pricepilot_enforce_free_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare existing integer; allowance integer; minimum_slots integer; bonus_slots integer;
begin
 if auth.uid() is null or new.user_id is distinct from auth.uid() then
  raise exception 'Account ownership required';
 end if;
 if tg_op='INSERT' then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,91231));
  select count(*) into existing from public.pricepilot_trackers where user_id=auth.uid();
  select coalesce(max(quantity),5) into minimum_slots from public.pricepilot_entitlement_grants
    where user_id=auth.uid() and grant_kind='slot_allowance_total'
      and grant_status='active' and (expires_at is null or expires_at>now());
  select coalesce(sum(quantity),0) into bonus_slots from public.pricepilot_entitlement_grants
    where user_id=auth.uid() and grant_kind='bonus_slots'
      and grant_status='active' and (expires_at is null or expires_at>now());
  allowance=least(500,greatest(5,minimum_slots)+bonus_slots);
  if existing>=allowance then raise exception 'Tracking allowance reached (% active slots)',allowance; end if;
 end if;
 new.updated_at=now();
 return new;
end; $$;
revoke all on function public.pricepilot_enforce_free_limit() from public,anon,authenticated;
