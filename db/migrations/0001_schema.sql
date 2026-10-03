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
