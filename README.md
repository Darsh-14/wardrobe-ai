# Wardrobe AI

An AI stylist: add photos of clothes you own, and it styles looks from them for an occasion, the weather and local trends.

| Folder | What it is |
|---|---|
| `frontend/` | React 19 + Vite + Tailwind web app (originally a Figma Make export) |
| `backend/` | Node + Hono API: auth, wardrobe, looks, trends, AI calls (see `backend/README.md`) |
| `db/` | Supabase Postgres schema, row level security and storage buckets (see `db/README.md`) |

Everything runs on free tiers: Supabase (database, sign-in, photo storage), Google Gemini (AI), Open-Meteo
(weather) and Render (hosting). One Docker image runs the API and serves the web app from the same address.

## Deploy (free)

1. **Database.** In Supabase, open SQL Editor > New query, paste `db/supabase-setup.sql`, Run (once).
2. **Sign-in.** Supabase > Authentication > Sign In / Providers > Email: turn off "Confirm email" (the free email
   sender only sends a few emails an hour). Leave it on if you set up your own SMTP.
3. **Hosting.** On [render.com](https://render.com) (free, no card): New > Blueprint > pick this repo. Render reads
   `render.yaml` and asks for three secrets:
   - `DATABASE_URL`: Supabase > Connect > **Session pooler** connection string, with your database password in place
     of `[YOUR-PASSWORD]`. (The "Direct connection" string is IPv6-only and won't work from Render.)
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase > Project Settings > API Keys > the **secret** key (`sb_secret_...`).
   - `GEMINI_API_KEY`: a free key from [Google AI Studio](https://aistudio.google.com/apikey).
4. Click Apply. The first build takes a few minutes; the app is then at `https://wardrobe-ai-<something>.onrender.com`.

Every push to `main` redeploys.

**Free tier limits worth knowing**
- Render's free service sleeps after 15 minutes without visits; the next visit wakes it in about a minute.
- Supabase pauses a free project after a week with no activity; resume it from the dashboard.
- Gemini's free tier is rate limited and its models are sometimes busy. The API falls back through
  `GEMINI_FALLBACK_MODELS` and shows "The AI stylist is busy" if all of them are.
- "See it on me" visualizations need a paid image model, so looks show your item photos instead.

## Run locally

```bash
# API on :8787 (see backend/README.md for running without any keys)
cd backend && npm install && cp .env.example .env && npm run dev
# web app on :8443, calling the API through Vite's proxy
cd frontend && pnpm install && pnpm dev
```
