-- PricePilot migration 004: ensure backend rows always belong to their tracker's owner.
alter table public.pricepilot_trackers
 add constraint pricepilot_trackers_id_user_unique unique(id,user_id);
alter table public.pricepilot_price_observations
 add constraint pricepilot_observations_tracker_owner_fk
 foreign key(tracker_id,user_id) references public.pricepilot_trackers(id,user_id) on delete cascade;
alter table public.pricepilot_check_attempts
 add constraint pricepilot_attempts_tracker_owner_fk
 foreign key(tracker_id,user_id) references public.pricepilot_trackers(id,user_id) on delete cascade;
alter table public.pricepilot_notifications
 add constraint pricepilot_notifications_tracker_owner_fk
 foreign key(tracker_id,user_id) references public.pricepilot_trackers(id,user_id) on delete cascade;
