# Deploying CodeTogether for free

This guide puts CodeTogether online at no cost, with no credit card:

| Part | Service | Free plan |
|---|---|---|
| Database | [Neon](https://neon.tech) Postgres | 0.5 GB storage, sleeps when idle and wakes in under a second |
| Backend API + WebSockets | [Render](https://render.com) web service | 512 MB RAM, sleeps after 15 minutes idle |
| Frontend | Render static site | Always on, served from a CDN |
| AI | [Google Gemini](https://aistudio.google.com/apikey) | Free-tier rate limits |

Everything is described in [`render.yaml`](../render.yaml) (a Render "Blueprint"), so Render creates both services in one step.

## Why not SQLite in production?

Free hosts give each server a temporary disk that is wiped on every deploy and restart. A SQLite file there would lose every account and message. The app therefore uses Postgres when `DATABASE_URL` points to one, and with `APP_ENV=production` it refuses to start on SQLite.

## 1. Create the database (Neon)

1. Sign up at https://neon.tech with GitHub or Google.
2. Create a project in **AWS US East 2 (Ohio)**. `render.yaml` runs the API in Render's Ohio region, so the server and database are close together. If you pick another Neon region, change `region:` in `render.yaml` to the nearest Render region (`oregon`, `ohio`, `virginia`, `frankfurt` or `singapore`).
3. On the project dashboard, click **Connect** and copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:abc123@ep-cool-name-123456.us-west-2.aws.neon.tech/neondb?sslmode=require
   ```
   Keep it secret: it contains the database password.

You don't need to create tables. The backend runs its migrations on startup.

## 2. Push the code to GitHub

Render deploys from a GitHub repository. Commit your work and push `main`.

## 3. Deploy with the Blueprint (Render)

1. Sign up at https://render.com with GitHub.
2. Click **New → Blueprint**, pick this repository, and confirm. Render reads `render.yaml`.
3. Render asks for the values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The Neon connection string from step 1 |
   | `CORS_ORIGINS` | `https://codetogether-web.onrender.com` |
   | `GEMINI_API_KEY` | Your free key from https://aistudio.google.com/apikey |
   | `VITE_API_URL` | `https://codetogether-api.onrender.com` |

   The URLs follow the service names in `render.yaml`. If Render shows a different URL for a service (for example because the name is taken), update both variables afterwards in each service's **Environment** tab. The frontend reads `VITE_API_URL` at build time, so redeploy it after changing that value.
4. Click **Apply**. The first build takes a few minutes.

`SECRET_KEY` is generated for you, and Render checks `/api/health` before sending traffic to a new deploy.

## 4. Check it works

1. Open `https://codetogether-api.onrender.com/api/health`. You should see `{"status":"ok","ai_mode":"gemini"}`.
2. Open the frontend URL, sign up, and send a message with **Ask AI** on.
3. Open the site in a second browser (or a private window), sign up as another user, and type in the same file to see live co-editing.

If the API fails to start, open its **Logs** tab. A message starting with `Invalid production settings` lists exactly which variable is missing.

## 5. Keep the API awake (optional)

A free Render service sleeps after 15 minutes without traffic, and the next visitor waits up to a minute while it wakes. The login screen tells visitors when this is happening. To avoid the wait:

1. Sign up at https://uptimerobot.com (free).
2. Add an **HTTP(s)** monitor for `https://codetogether-api.onrender.com/api/health` every 5 minutes.

This also emails you if the site goes down. Render's free plan includes 750 hours a month, which covers one service running all month. `/api/health` doesn't touch the database, so Neon can still sleep and save its free compute hours.

## Updating the site

Push to `main`. Render rebuilds both services automatically. Database changes ship as Alembic migrations and run on startup:

```bash
cd backend
# after changing app/models.py
alembic revision --autogenerate -m "describe the change"
# review the new file in app/migrations/versions/, then commit it
```

`tests/test_database.py` fails if a model changes without a migration.

## Limits to know about

- **One backend instance.** WebSocket rooms, presence and the AI rate limiter live in the server's memory, so the app runs as a single instance. That fits the free plan. Running several instances would need a shared message bus such as Redis pub/sub.
- **Gemini free tier.** Google may use free-tier prompts to improve its products. Don't paste private code into the public demo.
- **Neon free storage** is 0.5 GB, which is plenty for chat history and code files.

## Other hosts

The backend is a standard Docker image (`backend/Dockerfile`) that listens on `$PORT`, so it also runs on Koyeb, Railway, Fly.io or a VPS. Set the same environment variables: `APP_ENV=production`, `SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS` and `GEMINI_API_KEY`. The frontend is a static build (`npm run build` → `frontend/dist`) that works on Vercel, Netlify or Cloudflare Pages with `VITE_API_URL` set.
