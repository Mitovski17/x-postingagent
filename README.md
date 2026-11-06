# X Posting Tool

A lean scheduler for X. You write posts in a small dashboard, and a publisher inside Supabase posts them at the right minute, even with your computer off.

```
Dashboard (your PC, localhost:3000)  ──writes──▶  Supabase: posts table
                                                      ▲
pg_cron, every minute ──▶ publish-due edge function ──┘──▶ X API (OAuth 1.0a)
```

## Run the dashboard

```bash
npm install
npm run dev
```

Open http://localhost:3000. Port 3000 matters: it's where Supabase sends email confirmation links.

## First-time setup (about 10 minutes)

1. **Create the owner account.** On the login screen click *Create the owner account* and use `martinmitovski17@gmail.com`. Only that email, once confirmed, can see or change anything. Confirm via the email Supabase sends, then sign in.
2. **Lock sign-ups.** In Supabase: Authentication > Sign In / Providers > turn off *Allow new users to sign up*. Nobody else can create an account after that.
3. **Prepare the X app** in the [X developer console](https://console.x.com):
   - User authentication settings > App permissions: **Read and write**
   - Keys and tokens: generate the **API Key + Secret**, then the **Access Token + Secret** (after setting Read and write, or the token stays read-only)
   - Add prepaid credits (about $0.015 per post, about $0.20 per post with a link)
4. **Connect X.** Dashboard > Settings > paste the four keys > Connect. They're checked against X before saving, then stored where only the publisher can read them.
5. **Long posts.** If the account has X Plus, turn on *Long posts* in Settings to allow up to 25,000 characters. Leave it off otherwise, or X rejects anything over 280.

## Deploy on Vercel

1. In Vercel: **Add New > Project**, import this repository. Vercel detects Vite on its own (build `npm run build`, output `dist`).
2. Add two environment variables, the same values as your local `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Deploy. Log in with the same email and password as on localhost.

Only those two public values go to Vercel. The X keys, Claude key, Telegram token and extension key live in Supabase, where the edge functions read them, so nothing else needs to be entered again. Never add a secret or service role key to Vercel or to `.env`.

`.npmrc` sets `legacy-peer-deps` because `@vitejs/plugin-react` 4.7 hasn't declared support for Vite 8 yet; it works fine.

## How publishing works

- `pg_cron` calls the `publish-due` edge function every minute with a secret stored in Supabase Vault.
- The function atomically claims due posts (`claim_due_posts`), so a post can never go out twice.
- Threads post part by part. Progress is saved after each part, so a failed thread resumes from where it stopped.
- Rate limits and X outages retry automatically (up to 4 attempts, 5 minutes apart and growing). Bad keys, duplicates, empty credits and similar problems mark the post **Failed** with a plain-English reason.
- A post stuck in *Publishing* for 10+ minutes is marked Failed rather than retried blindly, since part of it may already be live.
- The publisher's last run shows in the sidebar and in Settings. If it says *Not running*, the Supabase project was probably paused for inactivity (free plan): restore it from the Supabase dashboard.

## Adding posts from Claude or scripts

Any row in `public.posts` with `status = 'scheduled'` and a `scheduled_at` in the past gets published. Example:

```sql
insert into public.posts (parts, status, scheduled_at, source)
values (array['First post text'], 'scheduled', '2026-11-03 09:00+02', 'claude');

-- A thread: one array item per post
insert into public.posts (parts, status, scheduled_at, source)
values (array['1/ Hook', '2/ Point', '3/ Close'], 'scheduled', '2026-11-03 18:00+02', 'claude');
```

Use `status = 'draft'` to queue posts for review instead of auto-posting.

## Project layout

```
src/                      React dashboard (Vite, TypeScript, plain CSS tokens)
  pages/Queue.tsx         post list, stats, filters
  pages/Editor.tsx        new / edit, threads, scheduling, feed preview
  pages/Settings.tsx      X keys, long posts toggle, publisher health
  lib/xtext.ts            X's weighted character counting
supabase/migrations/      schema, RLS, claim function, cron job
supabase/functions/
  publish-due/            the publisher (cron + "Post now")
  x-connect/              saves / removes X keys
  _shared/x.ts            OAuth 1.0a signing + X API calls
```

## Redeploying edge functions

```bash
npx supabase login
npx supabase link --project-ref xssvfmbkgpchmfimjhdf
npx supabase functions deploy publish-due --no-verify-jwt
npx supabase functions deploy x-connect --no-verify-jwt
```

Both functions do their own auth (cron secret or the owner's session), which is why JWT verification is off.

## Hosting the dashboard (optional)

It runs fine locally. To open it from your phone, deploy the folder to Vercel or Netlify (build: `npm run build`, output: `dist`, env vars from `.env`), then add the new URL under Supabase Authentication > URL Configuration.
