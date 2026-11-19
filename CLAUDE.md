# Moments TV: notes for Claude

## What it is
The "Moments that Matter" office TV display. It rotates three scenes (this week + next Priority A moment, the 12-week grid, Priority A campaign timeline) on a 1920×1080 stage. **Planners edit a Google Sheet; the TV picks the change up within about 9 minutes, with no deploy.** The original brief and prototype are in `../moments-tv-handover/`.

Owner: Brad Gordon (brad@s-b.co.za), who administers GitHub, Vercel, Cloudflare DNS (sportingbetza.com) and Google Cloud.

## Stack
- Next.js 16 (App Router) + TypeScript, `next-auth` v5 (Google, @s-b.co.za only), `@upstash/redis`, `google-auth-library`, `sharp`. Same auth pattern and shared Google OAuth client as BetCheck, dashboards and shortener.
- The TV page itself is plain HTML/CSS/JS in `public/tv/` (served at `/` by a rewrite), so it stays a faithful copy of the prototype.
- GitHub `Greatodds-Pty-Ltd/moments-tv` (private) → Vercel; every push to `main` deploys.

## Key files
| What | Where |
|---|---|
| Data contract + validator (TV-safe column allowlist, row rules) | `src/lib/calendar.ts`, tests in `test/calendar.test.ts` |
| Reading the Sheet (Sheets API v4) and image folder (Drive API), or local CSVs | `src/lib/source.ts` |
| Last-good snapshot, 5-minute refresh | `src/lib/store.ts` |
| TV data / status / image endpoints | `src/app/api/data`, `src/app/api/status`, `src/app/api/image/[id]` |
| Sign-in gate | `src/proxy.ts`, `src/auth.ts`, `src/app/login/page.tsx` |
| TV page | `public/tv/index.html`, `tv.css`, `tv.js` |
| Sheet templates (also the local dev data) | `sheet-template/*.csv`, `sheet-template/images/` |
| Hero image prompt | `docs/image-prompt.md` |

## Data source: one Google Sheet
Tabs (headers in row 1; names are case-insensitive):
- **Events** (required): `start_date, end_date, time_sast, title, sport, priority (A|B|C|X), to_confirm, detail, campaign_id`. Should be an IMPORTRANGE/QUERY view of the weekly master calendar, TV-safe columns only.
- **Campaigns** (required): one row per window: `campaign_id, name, message, seg_start, seg_end, seg_label, main_window`.
- **Images** (optional): `match_type (event|sport), match_value, image_file, text_in_image, use_until, notes`. `image_file` is a file name in the image folder. An event match beats a sport match. `text_in_image=TRUE` shows only the countdown on top. After `use_until` the image is no longer shown.
- **Settings** (optional): `key, value, notes`. `week1_start` = Monday of W1 in the grid; once today is outside those 12 weeks the grid rolls forward so the current week is W1.

Dates are ISO (YYYY-MM-DD) or real date cells; times HH:MM or time cells.

Validation: a bad row is skipped and listed at `/api/status`; the rest still shows. A bad tab (missing, missing a required column, **or any column not on the allowlist**) fails the refresh and the TV keeps the last good data. `/api/status?refresh=1` re-reads the sheet immediately.

## Resilience (don't weaken)
- Server: never serves an error while it has last-good data (Upstash key `mtv:snapshot`).
- TV page: a failed or 401 poll keeps the current screen; shows "Data last updated …" after 2 hours and a sign-in note if the TV is signed out. Each scene renders independently. Full reload at 03:00 SAST only after the server answers. Clock and countdowns use SAST and correct for a drifting TV clock.
- Session lasts 30 days and rolls forward while the TV polls, so the kiosk account stays signed in.

## Making a change
1. `npm test && npx tsc --noEmit && npx eslint src test && npm run build` must all pass.
2. Preview locally: the `moments-tv` entry in the workspace `.claude/launch.json` (`npm run dev`, port 3005). Without Google credentials it reads `sheet-template/`. Signed-in testing: mint a session cookie with `next-auth/jwt` `encode` (salt `authjs.session-token`, local `AUTH_SECRET`, an @s-b.co.za test email). Never print secrets in chat.
3. Check visual parity at 1920×1080 for all three scenes.
4. Commit and push to `main` only when Brad asks.

## Environment (Vercel; names only, values in Vercel)
`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `GOOGLE_SHEET_ID`, `GOOGLE_IMAGE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON or base64 JSON), Upstash vars (via the Vercel integration), optional `ALLOWED_EMAILS`. See `.env.example`.

## Guardrails
- Internal display only. Any external reuse goes through rg-ad-compliance-check and the WCGRB route first.
- No customer data, no blockers/owners/offer mechanics/legal notes on the TV: keep the column allowlist in `calendar.ts`.
- Library images: no text, logos, crests, kit badges, sponsor marks or recognisable players (`docs/image-prompt.md`). The Boks image is the one exception (internal only, `use_until` 2026-11-21).
- The service account has Viewer access to the one sheet and the one image folder only. Never "Publish to web".
- No secrets in the repo.
