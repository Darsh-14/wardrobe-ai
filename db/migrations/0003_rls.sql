-- Row level security: a signed-in user can only see and change their own rows.
-- The backend's service-role key bypasses RLS for AI jobs and trend/weather writes.

alter table profiles         enable row level security;
alter table wardrobe_items   enable row level security;
alter table looks            enable row level security;
alter table look_items       enable row level security;
alter table outfit_log       enable row level security;
alter table trends           enable row level security;
alter table recommendations  enable row level security;
alter table shopping_queries enable row level security;
alter table weather_cache    enable row level security;

-- profiles: read/update self (insert happens via the signup trigger)
create policy profiles_select on profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Owner-only tables: full CRUD on own rows
create policy wardrobe_items_owner on wardrobe_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy looks_owner on looks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy look_items_owner on look_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy outfit_log_owner on outfit_log for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shopping_queries_owner on shopping_queries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- recommendations: AI-written by the backend; users read them and may dismiss
create policy recommendations_select on recommendations for select to authenticated using (user_id = auth.uid());
create policy recommendations_update on recommendations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- trends: readable by any signed-in user, written only by the service role
create policy trends_select on trends for select to authenticated using (true);

-- weather_cache: no policies, so only the service role can touch it

-- Supabase grants table privileges to anon/authenticated by default; keep anon out entirely.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
