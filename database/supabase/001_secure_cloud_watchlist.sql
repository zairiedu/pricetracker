-- Applied to Supabase project "pricepilot" on 2026-11-11.
-- Idempotent schema creation for new environments; migration history records
-- pricepilot_secure_tracker_foundation and restrict_rls_event_trigger_invocation.
create table if not exists public.pricepilot_trackers (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 url text not null check (length(url) between 12 and 2048 and url ~ '^https?://'),
 name text not null check (length(btrim(name)) between 1 and 120),
 target numeric(12,2) not null check (target>0),
 currency text not null check (currency in ('CAD','USD','EUR','GBP')),
 size text not null default '' check(length(size)<=40),
 color text not null default '' check(length(color)<=40),
 stock boolean not null default true,buy boolean not null default false,
 price numeric(12,2) check(price is null or price>=0),
 available boolean,checked timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists pricepilot_trackers_user_id_idx on public.pricepilot_trackers(user_id);
alter table public.pricepilot_trackers enable row level security;
revoke all on public.pricepilot_trackers from anon;
grant select,insert,update,delete on public.pricepilot_trackers to authenticated;
drop policy if exists pricepilot_trackers_select_own on public.pricepilot_trackers;
create policy pricepilot_trackers_select_own on public.pricepilot_trackers for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists pricepilot_trackers_insert_own on public.pricepilot_trackers;
create policy pricepilot_trackers_insert_own on public.pricepilot_trackers for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists pricepilot_trackers_update_own on public.pricepilot_trackers;
create policy pricepilot_trackers_update_own on public.pricepilot_trackers for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists pricepilot_trackers_delete_own on public.pricepilot_trackers;
create policy pricepilot_trackers_delete_own on public.pricepilot_trackers for delete to authenticated using ((select auth.uid())=user_id);
create or replace function public.pricepilot_enforce_free_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare existing integer;
begin
 if auth.uid() is null or new.user_id is distinct from auth.uid() then
  raise exception 'Account ownership required';
 end if;
 if tg_op='INSERT' then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,91231));
  select count(*) into existing from public.pricepilot_trackers where user_id=auth.uid();
  if existing>=5 then raise exception 'Free plan limit: five active trackers'; end if;
 end if;
 new.updated_at=now();
 return new;
end; $$;
revoke all on function public.pricepilot_enforce_free_limit() from public,anon,authenticated;
drop trigger if exists pricepilot_free_limit_guard on public.pricepilot_trackers;
create trigger pricepilot_free_limit_guard before insert or update
on public.pricepilot_trackers for each row execute function public.pricepilot_enforce_free_limit();
-- Existing project event trigger function should not be callable through public RPC.
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
