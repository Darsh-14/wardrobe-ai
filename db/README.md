# Wardrobe AI database (Postgres on Supabase)

Built from `plan/frontend-data-and-api.md`. Tested on plain Postgres 16 with `test/run.sh`
(migrations + seed + RLS smoke test all pass, 2026-10-03).

## Files

| File | What it does |
|---|---|
| `migrations/0001_schema.sql` | enums, 9 tables, indexes, `updated_at` triggers, profile-on-signup trigger |
| `migrations/0002_views_and_functions.sql` | derived data (`user_stats`, `category_summary`, `wardrobe_items_view`) and `wear_look()`, `set_look_items()` |
| `migrations/0003_rls.sql` | row level security: each user sees only their own rows |
| `migrations/0004_storage.sql` | Storage buckets `wardrobe`, `looks`, `avatars` with per-user folder policies |
| `seed.sql` | the frontend's mock data as one demo user (dev only) |
| `test/` | Supabase stub + RLS smoke test for plain Postgres: `PGURL=postgres://... bash db/test/run.sh` |

To apply on Supabase: `supabase init`, copy `migrations/*.sql` into `supabase/migrations/` (rename with
timestamps, e.g. `20261003000001_schema.sql`), `supabase db push`. Put `seed.sql` in `supabase/seed.sql`
for local dev. The seed inserts the demo user straight into `auth.users` without a password; to sign in
as her, create `maya@example.com` through Auth instead and drop that first insert.

## Tables

```
auth.users ──1:1── profiles
profiles ──< wardrobe_items
profiles ──< looks ──< look_items >── wardrobe_items
                looks ──< outfit_log            ("Wear This")
profiles ──< recommendations >── wardrobe_items (owned item)
profiles ──< shopping_queries
trends          (shared per city, backend-written)
weather_cache   (shared per city, backend-only)
```

| Table | Feeds | Notes |
|---|---|---|
| `profiles` | `GET/PATCH /api/me` | `id` = `auth.users.id`; created automatically on signup (name from signup metadata). `body_profile`, `style_prefs` are JSON for the settings rows. |
| `wardrobe_items` | wardrobe grid, add item | `category` enum = the frontend's chips. `ai_attributes` keeps the raw vision output; the named columns hold what the Add screen shows. |
| `looks` | generator, Your Look, Today's pick | Request fields + AI result in one row. `status` (LLM) and `visualization_status` (image) are `pending/ready/failed`, so the Loading screen can poll. Saved = `saved_at is not null`. |
| `look_items` | Your Look items | Ordered by `position`. Composite FKs on `(id, user_id)` make it impossible to put someone else's item in your look. |
| `outfit_log` | Wear This, "days styled" | One row per look per day. |
| `trends` | home, Trends | Per city, `rank` orders them. Per-user subtitles ("3 pieces you own") are computed by the API, not stored. |
| `recommendations` | For You | Price as `numeric` + currency; format "₹3,490" in the API. `dismissed_at` hides one. |
| `shopping_queries` | Shopping | `owned_item_ids` are wardrobe item ids the AI picked. |
| `weather_cache` | weather | Key `lower(trim(city))`; refresh when `fetched_at` is older than ~30 min. |

## Derived data (no stored counters to keep in sync)

- `user_stats` → `UserStats` (`wardrobe_count`, `saved_looks`, `days_styled`).
- `category_summary` → the four home tiles. "Shoes & more" = Shoes + Dresses + Accessories, which is how the mock numbers add up to 87.
- `wardrobe_items_view` → `WardrobeItem` with `worn_often` = in the user's top 25% by `wear_count` and worn at least 3 times.

## Endpoint → query cheat sheet

| Endpoint | Query |
|---|---|
| `GET /api/me/stats` | `select * from user_stats where user_id = $me` |
| `GET /api/wardrobe/summary` | `select * from category_summary where user_id = $me order by sort_order` (fill missing labels with 0) |
| `GET /api/wardrobe/items?category=` | `select * from wardrobe_items_view where user_id = $me [and category = $1] order by created_at desc` |
| `POST /api/wardrobe/scan` | upload to `wardrobe/<me>/<uuid>.jpg`, run vision + cutout, return `ItemScan`; nothing stored yet |
| `POST /api/wardrobe/items` | insert `wardrobe_items` with the paths from the scan |
| `POST /api/looks/generate` | insert `looks` (pending) → LLM → update result + `select set_look_items(id, $ids)` → queue visualization |
| `POST /api/looks/:id/swap` | `select set_look_items(id, $newIds)` |
| `POST/DELETE /api/looks/:id/save` | `update looks set saved_at = now()` / `null` |
| `POST /api/looks/:id/wear` | `select wear_look(id)` (returns false if already logged today) |
| `GET /api/looks/today` | latest look with `event_at::date = today`, else latest saved look |
| `GET /api/trends?location=` | `where lower(city) = lower($1) and current_date between active_from and coalesce(active_to, current_date) order by rank` |

## How the backend should connect

- Use the **user's JWT** (Supabase client with the user's access token, or `set request.jwt.claims` on a pooled
  connection) for anything the user reads or edits, so RLS enforces ownership.
- Use the **service role key** only in AI jobs that write results (`looks` result, visualization paths, `recommendations`,
  `trends`, `weather_cache`, generated images in the `looks` bucket). Never ship it to the browser.
- Image columns hold Storage paths (`<user_id>/<file>`). Return signed URLs to the frontend; pass through values that
  already start with `http` (the seed uses the mock's Unsplash URLs).

## Choices made (easy to change)

- Supabase Auth for login; the frontend still needs a minimal sign-in screen (email magic link or Google is the least UI).
- All buckets private with signed URLs, since wardrobe and body photos are personal.
- Trends stored per city rather than generated per user, so one AI call serves everyone in a city.
- `pgvector` left out for now; add an `embedding vector(…)` column on `wardrobe_items` if similarity search is needed later.
