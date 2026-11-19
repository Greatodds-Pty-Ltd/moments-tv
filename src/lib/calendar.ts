// The data contract between the Google Sheet and the TV, and the validator that
// enforces it. Pure functions only (no I/O) so they can be unit-tested.
//
// Rules of thumb:
// - A bad ROW is dropped (or degraded) and reported in `problems`; the rest of
//   the sheet still reaches the screen.
// - A bad TAB (missing, missing a required column, or carrying a column that
//   isn't on the TV-safe list) is fatal: the refresh fails and the TV keeps the
//   last good data. The column allowlist is a second guard that keeps
//   blockers, owners, offer mechanics, legal notes and customer data off the TV.

export type Priority = "A" | "B" | "C" | "X";

export interface TvEvent {
  start: string; // YYYY-MM-DD (SAST)
  end: string; // YYYY-MM-DD, inclusive
  time: string | null; // HH:MM SAST
  title: string;
  sport: string;
  priority: Priority;
  toConfirm: boolean;
  detail: string;
  campaignId: string | null;
}

export interface TvSegment {
  start: string;
  end: string;
  label: string;
  main: boolean;
}

export interface TvCampaign {
  id: string;
  name: string;
  message: string;
  segments: TvSegment[];
}

export interface TvImageRule {
  matchType: "event" | "sport";
  matchValue: string;
  file: string; // file name in the image folder
  textInImage: boolean; // the image already carries its own words: show only the countdown
  useUntil: string | null; // last day (SAST) the image may be shown
}

export interface TvSettings {
  week1Start: string | null; // Monday of W1 in the 12-week grid; rolls forward when out of range
}

export interface TvData {
  events: TvEvent[];
  campaigns: TvCampaign[];
  images: TvImageRule[];
  settings: TvSettings;
}

export type Cell = string | number | boolean | null | undefined;
export interface RawTab {
  headers: Cell[];
  rows: Cell[][];
}
export type RawTabs = Partial<Record<TabName, RawTab>>;
export type TabName = "Events" | "Campaigns" | "Images" | "Settings";

interface TabSpec {
  required: string[];
  optional: string[];
  mandatoryTab: boolean;
}

export const TABS: Record<TabName, TabSpec> = {
  Events: {
    required: ["start_date", "title", "priority"],
    optional: ["end_date", "time_sast", "sport", "to_confirm", "detail", "campaign_id"],
    mandatoryTab: true,
  },
  Campaigns: {
    required: ["campaign_id", "name", "seg_start"],
    optional: ["message", "seg_end", "seg_label", "main_window"],
    mandatoryTab: true,
  },
  Images: {
    required: ["match_type", "match_value", "image_file"],
    optional: ["text_in_image", "use_until", "notes"],
    mandatoryTab: false,
  },
  Settings: {
    required: ["key", "value"],
    optional: ["notes"],
    mandatoryTab: false,
  },
};

export class FatalSheetError extends Error {}

export interface NormalizeResult {
  data: TvData;
  problems: string[];
}

const PRIORITIES = new Set(["A", "B", "C", "X"]);

/** Turns the raw tabs into TV data. Throws FatalSheetError when a tab is unusable. */
export function normalize(tabs: RawTabs): NormalizeResult {
  const problems: string[] = [];

  const campaignsTab = readTab("Campaigns", tabs.Campaigns);
  const campaigns = parseCampaigns(campaignsTab, problems);
  const campaignIds = new Set(campaigns.map((c) => c.id));

  const eventsTab = readTab("Events", tabs.Events);
  const events = parseEvents(eventsTab, campaignIds, problems);
  if (events.length === 0) throw new FatalSheetError("Events tab has no valid rows");

  const images = tabs.Images ? parseImages(readTab("Images", tabs.Images), problems) : [];
  const settings = tabs.Settings ? parseSettings(readTab("Settings", tabs.Settings), problems) : { week1Start: null };

  return { data: { events, campaigns, images, settings }, problems };
}

// ---------- tabs ----------

interface Row {
  n: number; // sheet row number, for messages (header is row 1)
  get(col: string): Cell;
}

function headerKey(h: Cell): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function readTab(name: TabName, tab: RawTab | undefined): Row[] {
  const spec = TABS[name];
  if (!tab) {
    if (spec.mandatoryTab) throw new FatalSheetError(`${name} tab is missing`);
    return [];
  }
  const keys = tab.headers.map(headerKey);
  const allowed = new Set([...spec.required, ...spec.optional]);

  keys.forEach((k, i) => {
    if (k === "") {
      // A blank header is fine as long as nothing sits under it.
      if (tab.rows.some((r) => !isBlank(r[i]))) {
        throw new FatalSheetError(`${name} tab has data under a blank column header (column ${colLetter(i)})`);
      }
      return;
    }
    if (!allowed.has(k)) {
      throw new FatalSheetError(
        `${name} tab has a column that isn't on the TV-safe list: "${String(tab.headers[i]).trim()}". Remove it from the TV sheet.`,
      );
    }
  });
  const dupe = keys.find((k, i) => k && keys.indexOf(k) !== i);
  if (dupe) throw new FatalSheetError(`${name} tab has the column "${dupe}" twice`);
  const missing = spec.required.filter((k) => !keys.includes(k));
  if (missing.length) throw new FatalSheetError(`${name} tab is missing column(s): ${missing.join(", ")}`);

  const idx = new Map(keys.map((k, i) => [k, i]));
  return tab.rows
    .map((r, i) => ({ r, n: i + 2 }))
    .filter(({ r }) => r.some((c) => !isBlank(c)))
    .map(({ r, n }) => ({ n, get: (col: string) => (idx.has(col) ? r[idx.get(col)!] : undefined) }));
}

// ---------- events ----------

function parseEvents(rows: Row[], campaignIds: Set<string>, problems: string[]): TvEvent[] {
  const out: TvEvent[] = [];
  for (const row of rows) {
    const where = `Events row ${row.n}`;
    const title = text(row.get("title"));
    if (!title) {
      problems.push(`${where}: no title, row skipped`);
      continue;
    }
    const label = `${where} (${title})`;
    const start = toIsoDate(row.get("start_date"));
    if (!start) {
      problems.push(`${label}: start_date "${text(row.get("start_date"))}" isn't a date (use YYYY-MM-DD), row skipped`);
      continue;
    }
    let end = start;
    if (!isBlank(row.get("end_date"))) {
      const e = toIsoDate(row.get("end_date"));
      if (!e) {
        problems.push(`${label}: end_date "${text(row.get("end_date"))}" isn't a date, row skipped`);
        continue;
      }
      end = e;
    }
    if (end < start) {
      problems.push(`${label}: end_date is before start_date, row skipped`);
      continue;
    }
    const priority = text(row.get("priority")).toUpperCase();
    if (!PRIORITIES.has(priority)) {
      problems.push(`${label}: priority "${text(row.get("priority"))}" must be A, B, C or X, row skipped`);
      continue;
    }
    let time: string | null = null;
    if (!isBlank(row.get("time_sast"))) {
      time = toTime(row.get("time_sast"));
      if (!time) problems.push(`${label}: time_sast "${text(row.get("time_sast"))}" isn't HH:MM, shown without a time`);
    }
    const toConfirm = toBool(row.get("to_confirm"), `${label}: to_confirm`, problems);
    let campaignId: string | null = text(row.get("campaign_id")) || null;
    if (campaignId && !campaignIds.has(campaignId)) {
      problems.push(`${label}: campaign_id "${campaignId}" isn't on the Campaigns tab, link ignored`);
      campaignId = null;
    }
    out.push({
      start,
      end,
      time,
      title,
      sport: text(row.get("sport")),
      priority: priority as Priority,
      toConfirm,
      detail: text(row.get("detail")),
      campaignId,
    });
  }
  return out;
}

// ---------- campaigns ----------

function parseCampaigns(rows: Row[], problems: string[]): TvCampaign[] {
  const byId = new Map<string, TvCampaign>();
  for (const row of rows) {
    const where = `Campaigns row ${row.n}`;
    const id = text(row.get("campaign_id"));
    if (!id) {
      problems.push(`${where}: no campaign_id, row skipped`);
      continue;
    }
    const start = toIsoDate(row.get("seg_start"));
    if (!start) {
      problems.push(`${where} (${id}): seg_start "${text(row.get("seg_start"))}" isn't a date, row skipped`);
      continue;
    }
    let end = start;
    if (!isBlank(row.get("seg_end"))) {
      const e = toIsoDate(row.get("seg_end"));
      if (!e) {
        problems.push(`${where} (${id}): seg_end "${text(row.get("seg_end"))}" isn't a date, row skipped`);
        continue;
      }
      end = e;
    }
    if (end < start) {
      problems.push(`${where} (${id}): seg_end is before seg_start, row skipped`);
      continue;
    }
    let c = byId.get(id);
    if (!c) {
      const name = text(row.get("name"));
      if (!name) {
        problems.push(`${where} (${id}): no name, row skipped`);
        continue;
      }
      c = { id, name, message: text(row.get("message")), segments: [] };
      byId.set(id, c);
    }
    c.segments.push({
      start,
      end,
      label: text(row.get("seg_label")),
      main: toBool(row.get("main_window"), `${where} (${id}): main_window`, problems),
    });
  }
  for (const c of byId.values()) c.segments.sort((a, b) => a.start.localeCompare(b.start));
  return [...byId.values()];
}

// ---------- images ----------

function parseImages(rows: Row[], problems: string[]): TvImageRule[] {
  const out: TvImageRule[] = [];
  for (const row of rows) {
    const where = `Images row ${row.n}`;
    const file = text(row.get("image_file"));
    if (!file) continue; // a placeholder ("To add") row
    const matchType = text(row.get("match_type")).toLowerCase();
    if (matchType !== "event" && matchType !== "sport") {
      problems.push(`${where}: match_type must be event or sport, row skipped`);
      continue;
    }
    const matchValue = text(row.get("match_value"));
    if (!matchValue) {
      problems.push(`${where}: no match_value, row skipped`);
      continue;
    }
    let useUntil: string | null = null;
    if (!isBlank(row.get("use_until"))) {
      useUntil = toIsoDate(row.get("use_until"));
      if (!useUntil) {
        problems.push(`${where}: use_until isn't a date, row skipped`);
        continue;
      }
    }
    out.push({
      matchType,
      matchValue,
      file: baseName(file),
      textInImage: toBool(row.get("text_in_image"), `${where}: text_in_image`, problems),
      useUntil,
    });
  }
  return out;
}

// ---------- settings ----------

function parseSettings(rows: Row[], problems: string[]): TvSettings {
  const settings: TvSettings = { week1Start: null };
  for (const row of rows) {
    const key = headerKey(row.get("key"));
    if (key === "week1_start") {
      if (isBlank(row.get("value"))) continue;
      const d = toIsoDate(row.get("value"));
      if (d) settings.week1Start = mondayOf(d);
      else problems.push(`Settings row ${row.n}: week1_start isn't a date, ignored`);
    } else if (key) {
      problems.push(`Settings row ${row.n}: unknown setting "${text(row.get("key"))}", ignored`);
    }
  }
  return settings;
}

// ---------- values ----------

function isBlank(c: Cell): boolean {
  return c === null || c === undefined || (typeof c === "string" && c.trim() === "");
}

function text(c: Cell): string {
  if (isBlank(c)) return "";
  return String(c).replace(/\s+/g, " ").trim();
}

/** Google Sheets date serial (days since 1899-12-30) or an ISO date string. */
export function toIsoDate(c: Cell): string | null {
  if (typeof c === "number" && Number.isFinite(c) && c > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  if (typeof c !== "string") return null;
  const m = c.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return m[0];
}

/** A day fraction from Sheets (0.7777 = 18:40) or "H:MM"/"HH:MM". */
export function toTime(c: Cell): string | null {
  let h: number, m: number;
  if (typeof c === "number" && c >= 0 && c < 1) {
    const mins = Math.round(c * 1440);
    h = Math.floor(mins / 60);
    m = mins % 60;
    if (h === 24) return null;
  } else if (typeof c === "string") {
    const x = c.trim().match(/^(\d{1,2})[:h](\d{2})$/);
    if (!x) return null;
    h = Number(x[1]);
    m = Number(x[2]);
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toBool(c: Cell, label: string, problems: string[]): boolean {
  if (typeof c === "boolean") return c;
  if (isBlank(c)) return false;
  const s = String(c).trim().toUpperCase();
  if (["TRUE", "YES", "Y", "1"].includes(s)) return true;
  if (["FALSE", "NO", "N", "0"].includes(s)) return false;
  problems.push(`${label} "${String(c).trim()}" should be TRUE or FALSE, treated as FALSE`);
  return false;
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 864e5).toISOString().slice(0, 10);
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop()!.trim();
}

function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ---------- CSV (local dev data) ----------

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(src: string): RawTab {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = src.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers = [], ...rest] = rows;
  return { headers, rows: rest };
}
