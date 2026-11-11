-- PricePilot database migration 005: opt-in automatic monitoring.
-- Applied to Supabase pricepilot on 2026-11-11.
-- Project setup also requires Vault scheduler secrets and pg_cron/pg_net.
alter table public.pricepilot_trackers
 add column monitoring_enabled boolean not null default false,
 add column monitoring_interval_hours smallint not null default 24
  check(monitoring_interval_hours in (6,12,24));
create index pricepilot_monitor_enabled_idx
 on public.pricepilot_trackers(monitoring_enabled,created_at)
 where monitoring_enabled=true;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- One private random credential per Supabase project.
do $$
begin
 if not exists(select 1 from vault.secrets where name='pricepilot_sweep_token') then
   perform vault.create_secret(
     encode(extensions.gen_random_bytes(32),'hex'),
     'pricepilot_sweep_token',
     'PricePilot hourly monitoring scheduler');
 end if;
end $$;

-- The publishable project key should be stored in Vault as
-- 'pricepilot_sweep_public_key' by an administrator before enabling the schedule.
-- No service-role credentials are stored in the scheduled job.
create or replace function public.pricepilot_authorize_sweep(provided_secret text)
returns boolean language sql security definer set search_path = ''
as $$
 select provided_secret is not null and length(provided_secret)=64
  and exists(
   select 1 from vault.decrypted_secrets
   where name='pricepilot_sweep_token' and decrypted_secret=provided_secret
  );
$$;
revoke all on function public.pricepilot_authorize_sweep(text) from public,anon,authenticated;
grant execute on function public.pricepilot_authorize_sweep(text) to service_role;

create table public.pricepilot_monitor_results (
 id bigint generated always as identity primary key,
 tracker_id uuid not null,
 user_id uuid not null,
 status text not null check(status in ('verified','unverifiable','blocked','error')),
 details text not null default '' check(length(details)<=250),
 checked_at timestamptz not null default now(),
 foreign key(tracker_id,user_id) references public.pricepilot_trackers(id,user_id) on delete cascade
);
create index pricepilot_monitor_results_user_idx
 on public.pricepilot_monitor_results(user_id,checked_at desc);
alter table public.pricepilot_monitor_results enable row level security;
revoke all on public.pricepilot_monitor_results from anon,authenticated;
grant select on public.pricepilot_monitor_results to authenticated;
create policy pricepilot_monitor_results_own
 on public.pricepilot_monitor_results for select to authenticated
 using ((select auth.uid())=user_id);

-- Execute the following AFTER the Vault public key is provisioned.
-- Example for the current project; change the endpoint for new environments:
-- select cron.schedule('pricepilot-sweep-hourly','7 * * * *',
-- $run$
--  select net.http_post(
--   url:='https://sfuoimxxzezzovqsigev.supabase.co/functions/v1/pricepilot-sweep',
--   headers:=jsonb_build_object(
--    'Content-Type','application/json',
--    'apikey',(select decrypted_secret from vault.decrypted_secrets where name='pricepilot_sweep_public_key'),
--    'x-pricepilot-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='pricepilot_sweep_token')),
--   body:='{}'::jsonb,timeout_milliseconds:=12000);
-- $run$);
