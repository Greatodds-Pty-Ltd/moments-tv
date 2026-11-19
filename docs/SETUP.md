# Go-live checklist

Each step says who does it. Nothing here needs a code change.

## 1. Google Sheet (Brad / planners)
1. In the Sportingbet shared drive (per the 19 Drive Filing Map, not My Drive), create a Google Sheet **Moments TV feed** with tabs **Events**, **Campaigns**, **Images**, **Settings**.
2. Import `sheet-template/events.csv`, `campaigns.csv`, `images.csv`, `settings.csv` into the matching tabs.
3. Replace the Events tab with an IMPORTRANGE/QUERY view of the weekly master calendar that pulls **only** the nine Events columns. Any other column makes the TV refuse the update (and keep its last good data).
4. Note the sheet ID (the long string in its URL).

## 2. Image folder (marketing)
1. In the same shared drive, create a folder **Moments TV images**. Upload `sheet-template/images/rugby-ireland-v-springboks.jpg` (until 21 Nov) and new sport images made with `docs/image-prompt.md`.
2. Fill `image_file` on the Images tab with the exact file name. Check every image for crests, logos or garbled text first.
3. Note the folder ID (the string at the end of its URL).

## 3. Service account (Brad / IT, Google Cloud)
1. In the Sportingbet-owned GCP project, enable **Google Sheets API** and **Google Drive API**.
2. Create a service account `moments-tv-reader` with **no project roles**, and create a JSON key.
3. Share the sheet and the image folder with the service account email as **Viewer**. Do not use "Publish to web".
4. ⚠️ Before this step, confirm whether a new service account or cloud hosting needs Entain IT/infosec sign-off under the GSA (Sportingbet-OS file 15).

## 4. GitHub + Vercel (Brad)
1. Create the private repo `Greatodds-Pty-Ltd/moments-tv` and push this folder.
2. In Vercel, import the repo. Add the Upstash integration (any prefix works).
3. Environment variables (Production): `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (the shared OAuth client), `GOOGLE_SHEET_ID`, `GOOGLE_IMAGE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` (paste the JSON or base64 of it).
4. Domain: `moments.sportingbetza.com` → CNAME to Vercel in Cloudflare, **DNS-only (grey cloud)**.
5. Google Cloud Console → shared OAuth client → add the redirect URI `https://moments.sportingbetza.com/api/auth/callback/google`.

## 5. Office TV (IT)
1. Set up a kiosk Workspace account (@s-b.co.za) for the TV browser.
2. Open `https://moments.sportingbetza.com`, sign in once, and set the browser to full-screen/kiosk on start-up with sleep disabled.
3. The session lasts 30 days and rolls forward while the TV is on. If it is ever signed out, the screen keeps the calendar and says so at the top.

## 6. Acceptance
- Edit a row in the sheet: it shows on the TV within ~9 minutes (`/api/status?refresh=1` forces it immediately).
- Break a row (priority "Q"): that row disappears, everything else stays, and `/api/status` names the row.
- Add a column such as "owner" to Events: the TV keeps the previous data and `/api/status` shows the error.
- Add an image to the folder plus an Images row: it appears for the matching sport or event.
- Leave it running for 7 days unattended.
