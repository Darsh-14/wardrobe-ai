-- Wardrobe AI: whole database setup for a new Supabase project.
-- Paste into Supabase > SQL Editor > New query, then Run. Run it once (it is migrations 0001-0004 in order).

-- ===== migrations/0001_schema.sql =====
-- Wardrobe AI: core schema (Postgres 15+ on Supabase)
-- Every user-owned row carries user_id = auth.users.id. Images live in Supabase
-- Storage; tables store the object path (e.g. "<user_id>/<uuid>.jpg"), and the
-- backend turns paths into signed URLs before returning them to the frontend.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums (values match src/types.ts and the frontend's chip lists)
-- ---------------------------------------------------------------------------
create type item_category as enum ('Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories');
create type gen_status    as enum ('pending', 'ready', 'failed');

-- Shared trigger to keep updated_at current
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (UserProfile)
-- ---------------------------------------------------------------------------
create table profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  name               text not null default '',
  city               text,
  avatar_path        text,                         -- storage: avatars/<user_id>/...
  profile_completion smallint not null default 0 check (profile_completion between 0 and 100),
  style_dna          text,
  style_tags         text[] not null default '{}',
  body_profile       jsonb not null default '{}',  -- body & fit settings row
  style_prefs        jsonb not null default '{}',  -- style preferences settings row
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Create the profile automatically when someone signs up through Supabase Auth
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, city)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), nullif(trim(new.raw_user_meta_data ->> 'city'), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- wardrobe_items (WardrobeItem, ItemScan once saved)
-- ---------------------------------------------------------------------------
create table wardrobe_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles (id) on delete cascade,
  name               text not null,
  category           item_category not null,
  subcategory        text,                          -- "Button-down"
  color              text,
  pattern            text,
  material           text,
  style              text,
  season             text not null default 'All season',
  image_path         text not null,                 -- original photo
  cutout_path        text,                          -- background removed
  ai_attributes      jsonb not null default '{}',   -- raw vision-model output
  favorite           boolean not null default false,
  wear_count         integer not null default 0 check (wear_count >= 0),
  last_worn_on       date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, user_id)                              -- target for owner-checked FKs
);
create index wardrobe_items_user_category_idx on wardrobe_items (user_id, category, created_at desc);
create trigger wardrobe_items_updated_at before update on wardrobe_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- looks (LookRequest in, GeneratedLook out)
-- ---------------------------------------------------------------------------
create table looks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references profiles (id) on delete cascade,
  -- request
  occasion              text not null,
  style                 text not null,
  location              text,
  event_at              timestamptz,                -- date + time from the form
  weather               jsonb,                      -- { tempC, condition, advice } at generation time
  -- AI result
  title                 text,
  reasoning             text,
  tags                  text[] not null default '{}',
  style_match           smallint check (style_match between 0 and 100),
  status                gen_status not null default 'pending',  -- LLM step
  visualization_path    text,
  visualization_status  gen_status not null default 'pending',  -- image step (async, Loading screen polls)
  error                 text,
  saved_at              timestamptz,                -- non-null = "Save look"
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id)
);
create index looks_user_created_idx on looks (user_id, created_at desc);
create index looks_user_saved_idx   on looks (user_id, saved_at desc) where saved_at is not null;
create index looks_user_event_idx   on looks (user_id, event_at);
create trigger looks_updated_at before update on looks
  for each row execute function set_updated_at();

-- look_items: which wardrobe items make up a look, in display order.
-- The composite FKs guarantee a look can only use its own owner's items.
create table look_items (
  look_id          uuid not null,
  user_id          uuid not null,
  wardrobe_item_id uuid not null,
  position         smallint not null,
  primary key (look_id, position),
  unique (look_id, wardrobe_item_id),
  foreign key (look_id, user_id)          references looks (id, user_id)          on delete cascade,
  foreign key (wardrobe_item_id, user_id) references wardrobe_items (id, user_id) on delete cascade
);
create index look_items_item_idx on look_items (wardrobe_item_id);

-- ---------------------------------------------------------------------------
-- outfit_log ("Wear This" / outfit calendar)
-- ---------------------------------------------------------------------------
create table outfit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  look_id    uuid not null,
  worn_on    date not null default current_date,
  created_at timestamptz not null default now(),
  unique (look_id, worn_on),
  foreign key (look_id, user_id) references looks (id, user_id) on delete cascade
);
create index outfit_log_user_day_idx on outfit_log (user_id, worn_on desc);

-- ---------------------------------------------------------------------------
-- trends (shared per city; written by the backend with the service role)
-- ---------------------------------------------------------------------------
create table trends (
  id           uuid primary key default gen_random_uuid(),
  city         text not null,
  name         text not null,
  subtitle     text,                 -- generic; per-user "3 pieces you own" is computed by the API
  image_url    text,
  rank         smallint not null default 0,
  active_from  date not null default current_date,
  active_to    date,
  created_at   timestamptz not null default now()
);
create index trends_city_active_idx on trends (lower(city), active_from desc, rank);

-- ---------------------------------------------------------------------------
-- recommendations (For You)
-- ---------------------------------------------------------------------------
create table recommendations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles (id) on delete cascade,
  owned_item_id       uuid,
  product_name        text not null,
  product_image_url   text,
  product_url         text,
  price_amount        numeric(12, 2),
  price_currency      char(3) not null default 'INR',
  description         text,
  style_match         smallint check (style_match between 0 and 100),
  new_looks           smallint not null default 0,
  visualization_path  text,
  dismissed_at        timestamptz,
  created_at          timestamptz not null default now(),
  foreign key (owned_item_id, user_id) references wardrobe_items (id, user_id) on delete cascade
);
create index recommendations_user_idx on recommendations (user_id, created_at desc) where dismissed_at is null;

-- ---------------------------------------------------------------------------
-- shopping_queries (Shopping "Ask my stylist")
-- ---------------------------------------------------------------------------
create table shopping_queries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles (id) on delete cascade,
  prompt              text not null,
  owned_item_ids      uuid[] not null default '{}',   -- items the AI says you already own
  gap_title           text,
  gap_description     text,
  visualization_path  text,
  status              gen_status not null default 'pending',
  created_at          timestamptz not null default now()
);
create index shopping_queries_user_idx on shopping_queries (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- weather_cache (backend-only; one row per city, refreshed by the API)
-- ---------------------------------------------------------------------------
create table weather_cache (
  city_key   text primary key,      -- lower(trim(city))
  data       jsonb not null,        -- { tempC, condition, advice }
  fetched_at timestamptz not null default now()
);

-- ===== migrations/0002_views_and_functions.sql =====
-- Derived data the frontend shows but we don't store (see plan: "Derived, not stored").
-- Views run with the caller's rights (security_invoker), so RLS still applies.

-- Wardrobe grid: WardrobeItem incl. "worn often" = top quarter of the user's
-- items by wear_count, and worn at least 3 times.
create view wardrobe_items_view with (security_invoker = true) as
select
  wi.*,
  (wi.wear_count >= 3
   and percent_rank() over (partition by wi.user_id order by wi.wear_count) >= 0.75) as worn_often
from wardrobe_items wi;

-- GET /api/me/stats  (UserStats)
create view user_stats with (security_invoker = true) as
select
  p.id as user_id,
  (select count(*) from wardrobe_items wi where wi.user_id = p.id)                         as wardrobe_count,
  (select count(*) from looks l where l.user_id = p.id and l.saved_at is not null)         as saved_looks,
  (select count(distinct o.worn_on) from outfit_log o where o.user_id = p.id)              as days_styled
from profiles p;

-- GET /api/wardrobe/summary  (CategorySummary[]: the four home tiles)
-- "Shoes & more" groups Shoes, Dresses and Accessories, matching the mock counts (24+12+18+33 = 87).
create view category_summary with (security_invoker = true) as
with grouped as (
  select
    wi.user_id,
    case wi.category
      when 'Tops'      then 'Tops'
      when 'Outerwear' then 'Outerwear'
      when 'Bottoms'   then 'Bottoms'
      else 'Shoes & more'
    end as label,
    coalesce(wi.cutout_path, wi.image_path) as image_path,
    wi.created_at
  from wardrobe_items wi
)
select
  user_id,
  label,
  count(*) as count,
  (array_agg(image_path order by created_at desc))[1] as image_path,
  array_position(array['Tops', 'Outerwear', 'Bottoms', 'Shoes & more'], label) as sort_order
from grouped
group by user_id, label;

-- POST /api/looks/:id/wear  ("Wear This")
-- Logs the look for the day and bumps wear_count on its items, once per look per day.
create function wear_look(p_look_id uuid, p_worn_on date default current_date)
returns boolean
language plpgsql security invoker as $$
declare
  v_user uuid;
  v_inserted int;
begin
  select user_id into v_user from looks where id = p_look_id;
  if v_user is null then
    raise exception 'look % not found', p_look_id using errcode = 'P0002';
  end if;

  insert into outfit_log (user_id, look_id, worn_on)
  values (v_user, p_look_id, p_worn_on)
  on conflict (look_id, worn_on) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return false;  -- already logged today
  end if;

  update wardrobe_items wi
     set wear_count   = wi.wear_count + 1,
         last_worn_on = greatest(wi.last_worn_on, p_worn_on)
    from look_items li
   where li.look_id = p_look_id
     and li.wardrobe_item_id = wi.id;
  return true;
end $$;

-- Used by /api/looks/generate and /api/looks/:id/swap to (re)write a look's items
-- in one statement, keeping the order the LLM returned.
create function set_look_items(p_look_id uuid, p_item_ids uuid[])
returns void
language plpgsql security invoker as $$
declare
  v_user uuid;
begin
  select user_id into v_user from looks where id = p_look_id;
  if v_user is null then
    raise exception 'look % not found', p_look_id using errcode = 'P0002';
  end if;

  delete from look_items where look_id = p_look_id;
  insert into look_items (look_id, user_id, wardrobe_item_id, position)
  select p_look_id, v_user, item_id, (ord - 1)::smallint
    from unnest(p_item_ids) with ordinality as t(item_id, ord);
end $$;

-- ===== migrations/0003_rls.sql =====
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

-- ===== migrations/0004_storage.sql =====
-- Supabase Storage buckets for photos. All private; the backend returns signed URLs.
-- Object paths always start with the owner's user id: "<user_id>/<file>".
--   wardrobe        : item photos and background-removed cutouts
--   looks           : AI visualizations for looks, recommendations, shopping answers
--   avatars         : profile photos (also the "see it on you" source photo)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('wardrobe', 'wardrobe', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('looks',    'looks',    false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars',  'avatars',  false,  5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Users may read their own files in every bucket and upload/replace/delete their
-- own wardrobe photos and avatar. Generated images in "looks" are written by the backend only.
create policy "own files: read" on storage.objects for select to authenticated
  using (bucket_id in ('wardrobe', 'looks', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files: upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('wardrobe', 'avatars')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files: update" on storage.objects for update to authenticated
  using (bucket_id in ('wardrobe', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('wardrobe', 'avatars') and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files: delete" on storage.objects for delete to authenticated
  using (bucket_id in ('wardrobe', 'avatars')
         and (storage.foldername(name))[1] = auth.uid()::text);

