import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";
import { parseCsv, TABS, type Cell, type RawTabs, type TabName } from "./calendar";

// Where the raw data comes from.
// - Production: the Google Sheet and image folder, read with a service account
//   that has Viewer access to just those two items (never "Publish to web").
// - Local dev without Google credentials: the CSVs in sheet-template/.

const SHEET_ID = process.env.GOOGLE_SHEET_ID?.trim();
const FOLDER_ID = process.env.GOOGLE_IMAGE_FOLDER_ID?.trim();
const KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
const LOCAL_DIR = join(process.cwd(), "sheet-template");

export type SourceKind = "google" | "local";

export function sourceKind(): SourceKind {
  if (SHEET_ID && KEY) return "google";
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_DATA !== "true") {
    throw new Error("Google Sheet not configured (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_KEY)");
  }
  return "local";
}

let googleAuth: GoogleAuth | null = null;
function gauth(): GoogleAuth {
  if (!googleAuth) {
    // Accept the key JSON as-is or base64-encoded (easier to paste into Vercel).
    const raw = KEY!.startsWith("{") ? KEY! : Buffer.from(KEY!, "base64").toString("utf8");
    googleAuth = new GoogleAuth({
      credentials: JSON.parse(raw),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    });
  }
  return googleAuth;
}

async function gget(url: string): Promise<Response> {
  const client = await gauth().getClient();
  const { token } = await client.getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

const TAB_NAMES = Object.keys(TABS) as TabName[];

export async function fetchTabs(): Promise<RawTabs> {
  if (sourceKind() === "local") {
    const tabs: RawTabs = {};
    for (const name of TAB_NAMES) {
      try {
        tabs[name] = parseCsv(await readFile(join(LOCAL_DIR, `${name.toLowerCase()}.csv`), "utf8"));
      } catch {
        /* optional tab absent */
      }
    }
    return tabs;
  }

  // Which of our tabs exist (Images and Settings are optional), then read them in one call.
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID!)}`;
  const meta = (await (await gget(`${base}?fields=sheets.properties.title`)).json()) as {
    sheets: { properties: { title: string } }[];
  };
  const titles = new Map(meta.sheets.map((s) => [s.properties.title.trim().toLowerCase(), s.properties.title]));
  const present = TAB_NAMES.filter((n) => titles.has(n.toLowerCase()));
  if (!present.length) return {};

  const q = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" });
  for (const n of present) q.append("ranges", `'${titles.get(n.toLowerCase())!.replace(/'/g, "''")}'`);
  const body = (await (await gget(`${base}/values:batchGet?${q}`)).json()) as { valueRanges: { values?: unknown[][] }[] };

  const tabs: RawTabs = {};
  present.forEach((n, i) => {
    const [headers = [], ...rows] = (body.valueRanges[i]?.values ?? []) as Cell[][];
    tabs[n] = { headers, rows };
  });
  return tabs;
}

/** file name → file id, for every image in the folder. */
export async function listImages(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (sourceKind() === "local") {
    for (const f of await readdir(join(LOCAL_DIR, "images")).catch(() => [] as string[])) {
      if (/\.(jpe?g|png|webp)$/i.test(f)) out.set(f, `l_${Buffer.from(f).toString("base64url")}`);
    }
    return out;
  }
  if (!FOLDER_ID) return out;
  let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${FOLDER_ID}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: "nextPageToken, files(id, name)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) q.set("pageToken", pageToken);
    const page = (await (await gget(`https://www.googleapis.com/drive/v3/files?${q}`)).json()) as {
      files: { id: string; name: string }[];
      nextPageToken?: string;
    };
    for (const f of page.files) if (!out.has(f.name.trim())) out.set(f.name.trim(), f.id);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** The original bytes of an image the snapshot has already vouched for. */
export async function readImage(id: string): Promise<Buffer> {
  if (id.startsWith("l_")) {
    if (sourceKind() !== "local") throw new Error("local image in google mode");
    const name = Buffer.from(id.slice(2), "base64url").toString("utf8");
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) throw new Error("bad name");
    return readFile(join(LOCAL_DIR, "images", name));
  }
  const res = await gget(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  return Buffer.from(await res.arrayBuffer());
}
