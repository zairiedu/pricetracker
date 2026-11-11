-- PricePilot database migration 006: indexing for future multiuser growth.
-- Applied to connected Supabase project; harmless with empty history tables.
create index if not exists pp_attempts_tracker_owner_idx on public.pricepilot_check_attempts(tracker_id,user_id);
create index if not exists pp_grants_campaign_idx on public.pricepilot_entitlement_grants(campaign_id);
create index if not exists pp_results_tracker_owner_idx on public.pricepilot_monitor_results(tracker_id,user_id);
create index if not exists pp_alert_observation_idx on public.pricepilot_notifications(source_observation_id);
create index if not exists pp_alert_tracker_owner_idx on public.pricepilot_notifications(tracker_id,user_id);
create index if not exists pp_history_tracker_owner_idx on public.pricepilot_price_observations(tracker_id,user_id);
create index if not exists pp_history_user_idx on public.pricepilot_price_observations(user_id);
create index if not exists pp_referral_campaign_idx on public.pricepilot_referrals(campaign_id);
create index if not exists pp_referral_referrer_idx on public.pricepilot_referrals(referrer_user_id);
