# Moments TV: notes for Claude

## What it is
The "Moments that Matter" office TV display. It rotates three scenes (this week + next Priority A moment, the 12-week grid, Priority A campaign timeline) on a 1920×1080 stage. **The TV reads the Moments Campaign Calendar (the master Google Sheet Claude builds and refreshes weekly) directly, so it is always aligned with it; a change shows within about 9 minutes, with no deploy.** The original brief and prototype are in `../moments-tv-handover/`.

Owner: Brad Gordon (brad@s-b.co.za), who administers GitHub, Vercel, Cloudflare DNS (sportingbetza.com) and Google Cloud.

## Stack
- Next.js 16 (App Router) + TypeScript, `next-auth` v5 (Google, @s-b.co.za only), `@upstash/redis`, `google-auth-library`, `sharp`. Same auth pattern and shared Google OAuth client as BetCheck, dashboards and shortener.
- The TV page itself is plain HTML/CSS/JS in `public/tv/` (served at `/` by a rewrite), so it stays a faithful copy of the prototype.
- GitHub `Greatodds-Pty-Ltd/moments-tv` (private) → Vercel; every push to `main` deploys.

## Key files
| What | Where |
|---|---|
| Master-calendar reader (which columns, TV dates format, campaign windows) | `src/lib/calendar.ts`, tests in `test/calendar.test.ts` |
| Reading the master (Sheets API v4) and image folder (Drive API), or local CSVs | `src/lib/source.ts` |
| Last-good snapshot, 5-minute refresh | `src/lib/store.ts` |
| TV data / status / image endpoints | `src/app/api/data`, `src/app/api/status`, `src/app/api/image/[id]` |
| Sign-in gate | `src/proxy.ts`, `src/auth.ts`, `src/app/login/page.tsx` |
| TV page | `public/tv/index.html`, `tv.css`, `tv.js` |
| Local copy of the master (dev and tests only) | `sheet-template/calendar.csv`, `briefs.csv`, `tv-images.csv`, `images/` |
| Hero image prompt | `docs/image-prompt.md` |

## Data source: the master calendar
Sheet: **Moments Campaign Calendar – Rolling 12 Weeks** (`GOOGLE_SHEET_ID` = `1jqLH0dcku4oGBOBMD-9Binniv7Sh7kUEdW4cEhX3VuQ`). There is no separate feed sheet. Only three tabs are requested, and only these parts are read (`src/lib/calendar.ts`):
- **Calendar**: header row found by "Event" + "Priority". Columns read by name: `Week`, `Event`, `Sport`, `Job (01)`, `Priority`, `Brief`, `Date status`, and the TV columns Claude fills: **`TV dates`** (required), `TV title`, `TV detail`. Every other column is never read.
  - `TV dates`: entries separated by `;`, each `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` (SAST) or a range `YYYY-MM-DD..YYYY-MM-DD` (a start time is allowed before `..`). Each entry becomes one TV event. A row with an Event but no TV dates is skipped and listed at `/api/status`.
  - Priority: A/B/C (first letter, so "B (prep)" is B); "Context" → X. "Verify" in Date status → "To confirm" tag. Sport loses its bracket ("Football (PSL)" → Football); Job "Casino grows" → Casino art.
  - Week: the first "W<n> (<d> <Mon>…" sets W1; the year comes from "refreshed <date>" in the title row.
- **Priority A briefs**: only the `Field` row (`A1: Boks November finale` → id + name) and the `Single-minded message` row. Offers, budgets and channels are never read.
- **Hero images by name (the normal way):** a file in the **Moments TV images** folder (`GOOGLE_IMAGE_FOLDER_ID` = `1WGH9A73uxYkS8olqNCI6wd92PIhu1KM8`, shared drive, Viewer for the service account) named exactly like the row's **Event (column C)** plus `.jpg/.jpeg/.png/.webp` (e.g. `Black Friday.png`) replaces the default sport art for that event. Matching ignores the extension, case, extra spaces and –/- or ’/' styles. The image is the hero background with the title, date and countdown on top. The hero only shows Priority A events. Folder files that match no Event are listed at `/api/status` as `unmatchedImages`. Match in `src/lib/store.ts`, key in `imageKey()` (`calendar.ts`).
- **TV images tab** (optional, not created; for sport-wide images or countdown-only images with words baked in): `match_type (event|sport), match_value, image_file, text_in_image, use_until, notes`. Strict columns. Folder-name matches win, then tab event matches, then tab sport matches.
- Campaign timeline (scene 3) is derived: every non-Context row whose Brief names A<n> adds its TV dates as a window, red (main) if the row is Priority A, blue (pre-roll before the first main window, tail after) if B/C. Overlapping or back-to-back days merge.

**Keeping it aligned:** whenever Claude adds or changes a Calendar row, it fills `TV dates` (and a `TV title` short enough for the week list, roughly 30 characters, or about 22 with a "To confirm" tag) in the same edit. Rows moved to Archive drop off the TV. `sheet-template/` is a local copy (TV-read columns only) for dev and tests; it does not feed production.

Validation: a bad row or date entry is skipped and listed at `/api/status`; the rest still shows. A missing tab or missing required column fails the refresh and the TV keeps the last good data. `/api/status` also shows `calendarRefreshed` and `calendarStale` (older than 8 days). `/api/status?refresh=1` re-reads now.

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
- No customer data, no blockers/owners/offer mechanics/legal notes on the TV: `calendar.ts` reads only the named columns and brief rows; keep it that way (a test checks other columns never reach the data).
- Library images: no text, logos, crests, kit badges, sponsor marks or recognisable players (`docs/image-prompt.md`). The Boks image is the one exception (internal only, `use_until` 2026-11-21).
- The service account has Viewer access to the master calendar workbook and the one image folder only. Never "Publish to web". It can technically read every tab of that workbook (including Blockers); the code requests only Calendar, Priority A briefs and TV images.
- No secrets in the repo.
