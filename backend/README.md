# Wardrobe AI backend

The API the `gen ai` frontend calls. Built on the database in `../db` (Supabase Postgres).

**Stack:** Node 22 + TypeScript, [Hono](https://hono.dev), `postgres` (direct SQL), Supabase Auth + Storage,
Google Gemini (`gemini-3.8-flash`, free tier) for the gen AI calls, Open-Meteo for weather.

**Cost: free.** Every service it needs has a free tier: Gemini API (free key, no billing), Supabase (free plan:
database, auth, 1 GB storage), Open-Meteo (no key). Paid options are off unless you add their keys: Claude
(`AI_PROVIDER=claude`) and Replicate image generation (`REPLICATE_API_TOKEN`).

## Run it

```bash
npm install
cp .env.example .env        # fill in Supabase keys + a free Gemini key
npm run dev                 # http://localhost:8787
```

**Without any keys** (local Postgres, mock AI, files on disk):

```bash
# creates wardrobe_dev with ../db migrations + seed, prints its URL
PGURL=postgres://postgres:postgres@localhost:5432/postgres npm run db:local
# .env:
#   DATABASE_URL=<printed url>
#   SUPABASE_JWT_SECRET=any-string-of-32-plus-characters
#   AI_PROVIDER=mock  STORAGE_DRIVER=local  WEATHER_PROVIDER=mock
npm run dev
```

Sign a dev token for the seeded demo user (Maya, `00000000-0000-0000-0000-00000000a11a`) with that secret
(HS256, `aud: authenticated`, `sub: <user id>`) and send it as `Authorization: Bearer <token>`.

**Tests:** `PGURL=postgres://postgres:postgres@localhost:5432/postgres npm test` builds a throwaway database from
`../db` and runs every endpoint against it, including access between two users. `test/gemini.test.ts` checks the
Gemini adapter against a fake Gemini server.

**Deploy:** the repo root's `Dockerfile` builds the web app and this API into one image, and `render.yaml` deploys
it on Render's free plan (steps in the root README). With `STATIC_DIR` set, the API also serves the built web app,
sending `index.html` for any non-`/api` path. `backend/Dockerfile` builds the API alone.

## How it fits together

- **Auth.** Supabase Auth. The API verifies the access token on every request (HS256 with `SUPABASE_JWT_SECRET`,
  or the project's JWKS). `/api/auth/*` wraps Supabase sign-up/login so the frontend doesn't need supabase-js.
  New users get a `profiles` row from the signup trigger.
- **Access control.** Each request runs in a transaction as Postgres role `authenticated` with the caller's
  claims set, so the RLS policies in `../db/migrations/0003_rls.sql` decide what a user sees. AI results that users
  can't write themselves (recommendations, trends, visualization paths, weather cache) are written with the
  connection's own role.
- **Images.** Columns hold storage paths; responses carry 1-hour signed URLs. Seeded `https://` values pass through.
- **Slow work.** Image generation runs after the response is sent (in-process). The look comes back immediately
  with `visualizationStatus: "pending"` and the first item's photo as `visualizationUrl`; poll `GET /api/looks/:id`.
  For several instances, move `Jobs` (src/deps.ts) to a queue.

## Endpoints

All JSON. Everything except `/api/health` and `/api/auth/*` needs `Authorization: Bearer <access token>`.
Errors are `{ "error": "message" }` with a 4xx/5xx status. Response shapes match `gen ai/src/types.ts`; fields marked
*extra* are additions the current screens don't read yet.

| Method | Path | Body / query | Returns | Frontend use |
|---|---|---|---|---|
| POST | `/api/auth/signup` | `{ email, password, name? }` | `{ userId, session, needsEmailConfirmation }` | sign-up screen (to build) |
| POST | `/api/auth/login` | `{ email, password }` | `{ userId, session: { accessToken, refreshToken, expiresAt } }` | sign-in screen (to build) |
| POST | `/api/auth/refresh` | `{ refreshToken }` | `{ session }` | keep signed in |
| POST | `/api/auth/logout` | | 204 | |
| GET | `/api/me` | | `UserProfile` + *extra* `email, bodyProfile, stylePrefs` | top bar, Profile |
| PATCH | `/api/me` | any of `{ name, city, styleDna, styleTags, bodyProfile, stylePrefs }` | `UserProfile` | settings rows |
| POST | `/api/me/avatar` | multipart `file` | `UserProfile` | |
| GET | `/api/me/stats` | | `UserStats` | home, wardrobe, Profile |
| GET | `/api/weather` | `?location=` (default: profile city) | `Weather` + `location` | top bar, home |
| GET | `/api/wardrobe/summary` | | `CategorySummary[]` (always the 4 home tiles) | home |
| GET | `/api/wardrobe/items` | `?category=Tops` (or `All items`) | `WardrobeItem[]` | wardrobe grid + chips |
| POST | `/api/wardrobe/scan` | multipart `file` (JPEG/PNG/WebP, ≤10 MB) | `ItemScan` + *extra* `item` | Add item |
| POST | `/api/wardrobe/items` | the `item` from scan (fields editable) | `WardrobeItem` (201) | "Add to wardrobe" |
| PATCH | `/api/wardrobe/items/:id` | `{ favorite?, name?, category?, color?, … }` | `WardrobeItem` | heart icon |
| DELETE | `/api/wardrobe/items/:id` | | 204 | |
| POST | `/api/looks/generate` | `LookRequest` + optional `timezone` (default `Asia/Kolkata`) | `GeneratedLook` + *extra* `status, visualizationStatus, saved` (201) | "Create my look", "Try another" |
| GET | `/api/looks/:id` | | `GeneratedLook` | poll while `visualizationStatus` is `pending` |
| POST | `/api/looks/:id/swap` | `{ wardrobeItemId }` → `{ alternatives: WardrobeItem[] }`; `{ wardrobeItemId, replacementId }` → `GeneratedLook` | | "Change item" |
| POST / DELETE | `/api/looks/:id/save` | | `{ saved }` | "Save look" |
| POST | `/api/looks/:id/wear` | | `{ logged }` (false if already logged today) | "Wear This" |
| POST | `/api/looks/:id/visualize` | | `GeneratedLook` (202) | "See it on me" / retry |
| GET | `/api/looks/today` | | `{ id, title, imageUrl }` or `null` | home "Today's pick" |
| GET | `/api/looks` | `?saved=true` | `GeneratedLook[]` | saved looks |
| GET | `/api/trends` | `?location=` (default: profile city) | `Trend[]` (home shows first 3) | home, Trends |
| GET | `/api/recommendations` | | `Recommendation` + *extra* `id, productName` | For You |
| POST | `/api/recommendations/refresh` | | `Recommendation` (201) | |
| POST | `/api/recommendations/:id/dismiss` | | 204 | |
| POST | `/api/shopping/ask` | `{ prompt }` | `ShoppingAdvice` + *extra* `id, status` (201) | "Ask my stylist" |
| GET | `/api/shopping/:id` | | `ShoppingAdvice` | poll for the visualization |

Behaviour worth knowing:

- "Try another" is just another `generate` call; the API avoids combinations it suggested for the same occasion in the last day.
- `tempC` on a look is `null` when the weather lookup fails; the look still generates.
- Trends are stored per city and generated by the AI the first time a city is asked for (valid 30 days).
  Subtitles are generic ("Wide legs and boxy jackets"), not per-user ("3 pieces you own").
- Recommendations: the first `GET` generates one if none exists (needs 3+ items, else 409).
- There is no product catalog yet, so `suggestedImageUrl` is the generated visualization or the owned item's photo.

## Gen AI calls

| Call | Where | Model |
|---|---|---|
| Item scan (tags from a photo) | `POST /wardrobe/scan` | Gemini vision, JSON schema output, no thinking |
| Look generation (items, title, reasoning, tags, match) | `POST /looks/generate` | Gemini, JSON schema output |
| Recommendations, Shopping answers, city trends | their endpoints | Gemini, JSON schema output |
| Background removal | `POST /wardrobe/scan` | off by default (paid Replicate) |
| Visualizations (looks, For You, Shopping, trends) | background job | off by default (paid Replicate); the item photos show instead |

**Switching provider.** Prompts live in `src/ai/stylist.ts` and are shared. A provider is one small `ask` function
(send a prompt and optional photo, return JSON matching a zod schema): `src/ai/gemini.ts` (default) and
`src/ai/claude.ts`. To add another (Groq, OpenRouter, a local Ollama), write a new `ask` and add it to `AI_PROVIDER`.
`AI_PROVIDER=mock` swaps in deterministic answers (`src/ai/mock.ts`). Every answer is validated against its schema, and
item ids the model returns are checked against the user's wardrobe before anything is saved.

**Gemini free tier limits.** Free keys are rate limited per minute and per day (see Google AI Studio for current
numbers); the adapter retries once on a rate limit, then the endpoint returns 502. Google may use free-tier prompts to
improve its products, so don't put anything sensitive in profiles. If limits become a problem, set
`GEMINI_MODEL=gemini-flash-lite-latest` (higher free limits; the 2.5 models are closed to new keys) or turn on billing.

The Replicate defaults are text-to-image (FLUX schnell) and a background remover; a true "on you" try-on from the
user's photo needs a try-on model and is not wired yet.

## Layout

```
src/
  server.ts        entry: wires config, db, storage, AI, weather
  app.ts           routes + CORS + auth middleware
  config.ts        environment variables
  auth.ts          token verification, /api/auth/*
  db.ts            postgres client, asUser (RLS) / asService
  storage.ts       Supabase Storage or local disk, signed URLs
  weather.ts       Open-Meteo + cache
  queries.ts       shared reads, row -> API shape
  ai/              stylist.ts (prompts), gemini.ts, claude.ts, mock.ts, images.ts (Replicate), types.ts (schemas)
  routes/          me, wardrobe, looks, trends, stylist (recommendations + shopping)
test/              api.test.ts (end to end on real Postgres), gemini.test.ts
scripts/local-db.sh  local database from ../db
```
