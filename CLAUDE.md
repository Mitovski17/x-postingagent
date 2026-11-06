# X Posting Tool: notes for Claude Code

Single-user X (Twitter) scheduler. React dashboard on localhost:3000, Supabase backend, publisher runs in Supabase via pg_cron.

## Stack
- Vite 5 + React 18 + TypeScript, plain CSS with tokens in `src/styles.css`. No Tailwind, no UI kit.
- Supabase project `xssvfmbkgpchmfimjhdf` ("X Posting Tool", eu-central-1). Publishable key in `.env`.
- Edge functions are Deno (`supabase/functions`), shared code in `_shared/`.
- Icons: lucide-react. Fonts: Geist + Geist Mono via @fontsource.

## Data model
- `posts`: `parts text[]` (index 0 = post, rest = thread replies), `status` enum draft|scheduled|publishing|posted|failed, `scheduled_at`, `posted_at`, `x_post_ids text[]` (grows per live part, used to resume threads), `error`, `attempts`, `source` manual|claude.
- `app_settings`: single row (`id = true`). Owner can only update `long_posts`; everything else is written by edge functions (X username, publisher heartbeat).
- `x_credentials`: single row, OAuth 1.0a keys. RLS on, no policies, no grants: service role only. Never expose to the client.

## Security rules
- Every policy uses `public.is_owner()`, which checks the confirmed email `martinmitovski17@gmail.com`. Change it there if the owner email changes.
- `claim_due_posts` and `verify_cron_secret` are service-role only.
- Edge functions run with `verify_jwt = false` and authenticate themselves: `publish-due` accepts the Vault cron secret (`x-cron-secret` header) or an owner session; `x-connect` requires an owner session.

## Design rules (keep them)
- Strictly monochrome. Status is shown by icon + label + fill/outline/dashed border, never by color.
- Text contrast 4.5:1 minimum in both themes; the theme follows `prefers-color-scheme`.
- Mono font for times, counts and labels; sans for content.
- Motion 140 to 200ms, respect `prefers-reduced-motion`.

## Gotchas
- X counts characters by weight (links = 23, emoji/CJK = 2). Use `weightedLength` from `src/lib/xtext.ts`.
- In SQL functions reading `vault.decrypted_secrets`, don't name a parameter `secret`: the view has a column with that name.
- X API is pay-per-use: about $0.015 per post, about $0.20 per post containing a link.
