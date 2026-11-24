# Go-live checklist

Each step says who does it. Nothing here needs a code change.

## 1. The sheet (done)
The TV reads the master **Moments Campaign Calendar – Rolling 12 Weeks** directly (ID `1jqLH0dcku4oGBOBMD-9Binniv7Sh7kUEdW4cEhX3VuQ`); there is no separate feed sheet. Claude added the `TV dates`, `TV title` and `TV detail` columns (N–P on the Calendar tab) on 24 Nov 2026 and fills them on every refresh. Nothing to build here.

- The workbook is in a Sportingbet shared drive (checked 24 Nov 2026), so it survives staff changes.

## 2. Image folder (done)
**Moments TV images** in the shared drive, next to the calendar (folder ID `1WGH9A73uxYkS8olqNCI6wd92PIhu1KM8`), shared with the service account as Viewer. Set `GOOGLE_IMAGE_FOLDER_ID` to that ID in Vercel.

To give an event its own hero image, upload a file named exactly like its **Event** in column C of the calendar, e.g. `Black Friday.png` (`.jpg`, `.png` or `.webp`). It shows within ~9 minutes. Images with no matching Event are listed at `/api/status` under `unmatchedImages`. Check every image for crests, logos or garbled text first (`docs/image-prompt.md`).

## 3. Service account (Brad / IT, Google Cloud)
1. In the Sportingbet-owned GCP project, enable **Google Sheets API** and **Google Drive API**.
2. Create a service account `moments-tv-reader` with **no project roles**, and create a JSON key.
3. Share the master calendar and the image folder with the service account email as **Viewer**. Do not use "Publish to web".
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
- `/api/status` shows `"ok": true`, `"source": "google"`, `"problems": []` and today's `calendarRefreshed`.
- Change a row's TV title in the master: it shows on the TV within ~9 minutes (`/api/status?refresh=1` forces it immediately).
- Blank a row's TV dates: that row disappears, everything else stays, and `/api/status` names the row.
- Rename the TV dates header: the TV keeps the previous data and `/api/status` shows the error.
- Add an image to the folder plus an Images row: it appears for the matching sport or event.
- Leave it running for 7 days unattended.
