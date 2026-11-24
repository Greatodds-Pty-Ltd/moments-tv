// The data contract between the Moments Campaign Calendar (the master Google
// Sheet Claude maintains) and the TV, and the validator that enforces it.
// Pure functions only (no I/O) so they can be unit-tested.
//
// The TV reads the master directly, so it can never drift from it:
// - Calendar tab: one row per moment. The TV reads ONLY these columns, by
//   header name: Week, Event, Sport, Job, Priority, Brief, Date status, and the
//   three TV columns Claude fills on every refresh (TV dates, TV title, TV
//   detail). Every other column (why it matters, acquisition, retention,
//   sources...) is never read.
// - Priority A briefs tab: only the "Field" header row (campaign id and name)
//   and the "Single-minded message" row. Offers, budgets and channels are never read.
// - TV images tab (optional): which hero image goes with which event or sport.
// - Blockers, Sources, Archive and Change log are never requested.
//
// A bad ROW is dropped and reported in `problems`; the rest still shows. A bad
// TAB (missing, or missing a required column) is fatal: the refresh fails and
// the TV keeps the last good data.

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
  week1Start: string | null; // Monday of W1, from the Week column; the TV rolls forward when out of range
  refreshed: string | null; // "refreshed <date>" in the Calendar title, as YYYY-MM-DD
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

/** The master's tabs as raw rows. Calendar and briefs keep every row, title rows included. */
export interface MasterTabs {
  calendar?: Cell[][];
  briefs?: Cell[][];
  images?: RawTab;
}

/** Sheet tab titles (matched case-insensitively). */
export const MASTER_TABS = { calendar: "Calendar", briefs: "Priority A briefs", images: "TV images" } as const;

const IMAGE_COLS = {
  required: ["match_type", "match_value", "image_file"],
  optional: ["text_in_image", "use_until", "notes"],
};

export class FatalSheetError extends Error {}

export interface NormalizeResult {
  data: TvData;
  problems: string[];
  /** Event (column C) → TV title, for matching image files named after the event. Server-side only. */
  eventNames: { event: string; title: string }[];
}

/** Turns the master's tabs into TV data. Throws FatalSheetError when a tab is unusable. */
export function normalize(tabs: MasterTabs): NormalizeResult {
  const problems: string[] = [];
  if (!tabs.calendar) throw new FatalSheetError(`${MASTER_TABS.calendar} tab is missing`);
  if (!tabs.briefs) throw new FatalSheetError(`${MASTER_TABS.briefs} tab is missing`);

  const briefs = parseBriefs(tabs.briefs);
  const cal = parseCalendar(tabs.calendar, new Set(briefs.keys()), problems);
  if (cal.events.length === 0) throw new FatalSheetError("Calendar tab has no rows the TV can show");

  const campaigns = buildCampaigns(briefs, cal.links);
  const images = tabs.images ? parseImages(readTab(MASTER_TABS.images, tabs.images), problems) : [];
  return { data: { events: cal.events, campaigns, images, settings: cal.settings }, problems, eventNames: cal.eventNames };
}

// ---------- calendar ----------

function headerKey(h: Cell): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// header key → our name; "Job (01)" → job_01, so jobs match on the prefix
const CAL_COLUMNS: [string, (k: string) => boolean][] = [
  ["week", (k) => k === "week"],
  ["event", (k) => k === "event"],
  ["sport", (k) => k === "sport"],
  ["job", (k) => k === "job" || k.startsWith("job_")],
  ["priority", (k) => k === "priority"],
  ["brief", (k) => k === "brief"],
  ["date_status", (k) => k === "date_status"],
  ["tv_dates", (k) => k === "tv_dates"],
  ["tv_title", (k) => k === "tv_title"],
  ["tv_detail", (k) => k === "tv_detail"],
];
const CAL_REQUIRED = ["event", "priority", "tv_dates"];

interface Link {
  ids: string[];
  priority: Priority;
  occ: Occurrence[];
  title: string;
}

function parseCalendar(grid: Cell[][], briefIds: Set<string>, problems: string[]) {
  const hi = grid.slice(0, 15).findIndex((r) => {
    const keys = r.map(headerKey);
    return keys.includes("event") && keys.includes("priority");
  });
  if (hi < 0) throw new FatalSheetError("Calendar tab: no header row with Event and Priority in the first 15 rows");
  const keys = grid[hi].map(headerKey);
  const col = new Map<string, number>();
  for (const [name, match] of CAL_COLUMNS) {
    const i = keys.findIndex(match);
    if (i >= 0) col.set(name, i);
  }
  const missing = CAL_REQUIRED.filter((c) => !col.has(c));
  if (missing.length) throw new FatalSheetError(`Calendar tab is missing column(s): ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}`);

  const events: TvEvent[] = [];
  const links: Link[] = [];
  const eventNames: { event: string; title: string }[] = [];
  let week1: string | null = null;
  const refreshed = refreshedDate(grid.slice(0, hi).flat());

  grid.slice(hi + 1).forEach((r, i) => {
    const n = hi + 2 + i; // sheet row number
    const get = (c: string) => (col.has(c) ? r[col.get(c)!] : undefined);
    const event = text(get("event"));
    if (!event) return; // blank or spacer row
    const title = text(get("tv_title")) || event;
    const where = `Calendar row ${n} (${title})`;

    week1 ??= week1From(text(get("week")), refreshed);

    const pr = text(get("priority")).toUpperCase();
    const priority: Priority | null = pr.startsWith("CONTEXT") ? "X" : (pr.match(/^([ABC])\b/)?.[1] as Priority | undefined) ?? null;
    if (!priority) {
      problems.push(`${where}: priority "${text(get("priority"))}" isn't A, B, C or Context, not shown`);
      return;
    }
    const rawDates = get("tv_dates");
    if (isBlank(rawDates)) {
      problems.push(`${where}: no TV dates, not shown on the TV`);
      return;
    }
    const occ = parseTvDates(rawDates, `${where}: TV dates`, problems);
    if (!occ.length) return;

    const ids = [...new Set(text(get("brief")).toUpperCase().match(/\bA\d+\b/g) ?? [])];
    for (const id of ids) if (!briefIds.has(id)) problems.push(`${where}: brief ${id} isn't on the Priority A briefs tab, link ignored`);
    const known = ids.filter((id) => briefIds.has(id));

    let sport = text(get("sport")).replace(/\s*\(.*\)\s*$/, "");
    if (/^casino/i.test(text(get("job")))) sport = "Casino";
    const toConfirm = /\bverify\b/i.test(text(get("date_status")));
    const detail = text(get("tv_detail"));

    for (const o of occ) {
      events.push({ start: o.start, end: o.end, time: o.time, title, sport, priority, toConfirm, detail, campaignId: known[0] ?? null });
    }
    if (known.length && priority !== "X") links.push({ ids: known, priority, occ, title });
    eventNames.push({ event, title });
  });

  return { events, links, eventNames, settings: { week1Start: week1, refreshed } as TvSettings };
}

interface Occurrence {
  start: string;
  end: string;
  time: string | null;
}

/** "2026-11-29 18:40", "2026-11-27..2026-11-29", "2027-01-17 15:30..2027-02-21", separated by ";" or new lines. */
export function parseTvDates(c: Cell, label: string, problems: string[]): Occurrence[] {
  if (typeof c === "number") {
    const d = toIsoDate(c);
    return d ? [{ start: d, end: d, time: null }] : [];
  }
  const out: Occurrence[] = [];
  for (const part of String(c ?? "").split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2}))?$/);
    const start = m && toIsoDate(m[1]);
    const end = m && (m[3] ? toIsoDate(m[3]) : start);
    const time = m?.[2] ? toTime(m[2]) : null;
    if (!m || !start || !end || end < start || (m[2] && !time)) {
      problems.push(`${label} "${part}" isn't YYYY-MM-DD[ HH:MM][..YYYY-MM-DD], skipped`);
      continue;
    }
    out.push({ start, end, time });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "…refreshed 23 Nov 2026" in the title rows. */
function refreshedDate(cells: Cell[]): string | null {
  for (const c of cells) {
    const m = text(c).match(/refreshed\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i);
    const mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
    if (m && mi >= 0) return isoOf(Number(m[3]), mi, Number(m[1]));
  }
  return null;
}

/** "W2 (23–29 Nov)" or "W3 (30 Nov–6 Dec)" → the Monday of W1. The year is the one nearest the refresh date. */
export function week1From(week: string, refreshed: string | null): string | null {
  const m = week.match(/^W(\d+)\s*\((\d{1,2})(?:\s+([A-Za-z]{3})[a-z]*)?\s*[–-]\s*\d{1,2}\s+([A-Za-z]{3})/);
  if (!m) return null;
  const mi = MONTHS.indexOf((m[3] ?? m[4]).toLowerCase());
  if (mi < 0) return null;
  const ref = refreshed ? Date.parse(refreshed) : Date.now();
  const base = new Date(ref).getUTCFullYear();
  const day = [base - 1, base, base + 1]
    .map((y) => isoOf(y, mi, Number(m[2])))
    .sort((a, b) => Math.abs(Date.parse(a) - ref) - Math.abs(Date.parse(b) - ref))[0];
  const w1 = new Date(Date.parse(mondayOf(day)) - (Number(m[1]) - 1) * 7 * 864e5);
  return w1.toISOString().slice(0, 10);
}

function isoOf(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

/**
 * Key for matching an image file to an Event (column C): "Black Friday.png" ↔ "Black Friday".
 * Ignores the extension, case, extra spaces, and dash/apostrophe styles (– vs -, ’ vs ').
 */
export function imageKey(name: string): string {
  return name
    .normalize("NFC")
    .replace(/\.(jpe?g|png|webp)$/i, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------- briefs ----------

/** id → {name, message}, from the "Field" row ("A1: Boks November finale") and the "Single-minded message" row only. */
function parseBriefs(grid: Cell[][]): Map<string, { name: string; message: string }> {
  const fieldRow = grid.find((r) => headerKey(r[0]) === "field");
  if (!fieldRow) throw new FatalSheetError(`${MASTER_TABS.briefs} tab: no "Field" header row`);
  const msgRow = grid.find((r) => headerKey(r[0]).startsWith("single_minded_message"));
  const out = new Map<string, { name: string; message: string }>();
  fieldRow.forEach((c, i) => {
    const m = text(c).match(/^(A\d+)\s*:\s*(.+)$/i);
    if (i > 0 && m) out.set(m[1].toUpperCase(), { name: m[2], message: msgRow ? text(msgRow[i]) : "" });
  });
  return out;
}

/** Campaign windows come from the calendar rows linked to each brief: Priority A rows are the main window, B/C rows pre-roll or tail. */
function buildCampaigns(briefs: Map<string, { name: string; message: string }>, links: Link[]): TvCampaign[] {
  const out: TvCampaign[] = [];
  for (const [id, b] of briefs) {
    const raw = links
      .filter((l) => l.ids.includes(id))
      .flatMap((l) => l.occ.map((o) => ({ start: o.start, end: o.end, main: l.priority === "A" })))
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    if (!raw.length) continue;
    // merge overlapping or back-to-back days of the same kind
    const segs: { start: string; end: string; main: boolean }[] = [];
    for (const s of raw) {
      const last = segs[segs.length - 1];
      if (last && last.main === s.main && s.start <= addDays(last.end, 1)) {
        if (s.end > last.end) last.end = s.end;
      } else segs.push({ ...s });
    }
    const firstMain = segs.find((s) => s.main)?.start ?? null;
    out.push({
      id,
      name: b.name,
      message: b.message,
      segments: segs.map((s) => ({
        ...s,
        label: s.main ? "" : firstMain && s.start < firstMain ? "Pre-roll" : "Tail",
      })),
    });
  }
  return out;
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
}

// ---------- TV images tab (strict: Claude owns it, nothing else belongs there) ----------

interface Row {
  n: number;
  get(col: string): Cell;
}

function readTab(name: string, tab: RawTab): Row[] {
  const keys = tab.headers.map(headerKey);
  const allowed = new Set([...IMAGE_COLS.required, ...IMAGE_COLS.optional]);
  keys.forEach((k, i) => {
    if (k === "") {
      if (tab.rows.some((r) => !isBlank(r[i]))) {
        throw new FatalSheetError(`${name} tab has data under a blank column header (column ${colLetter(i)})`);
      }
      return;
    }
    if (!allowed.has(k)) throw new FatalSheetError(`${name} tab has an unexpected column: "${String(tab.headers[i]).trim()}"`);
  });
  const missing = IMAGE_COLS.required.filter((k) => !keys.includes(k));
  if (missing.length) throw new FatalSheetError(`${name} tab is missing column(s): ${missing.join(", ")}`);
  const idx = new Map(keys.map((k, i) => [k, i]));
  return tab.rows
    .map((r, i) => ({ r, n: i + 2 }))
    .filter(({ r }) => r.some((c) => !isBlank(c)))
    .map(({ r, n }) => ({ n, get: (col: string) => (idx.has(col) ? r[idx.get(col)!] : undefined) }));
}

// ---------- images ----------

function parseImages(rows: Row[], problems: string[]): TvImageRule[] {
  const out: TvImageRule[] = [];
  for (const row of rows) {
    const where = `TV images row ${row.n}`;
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
export function parseCsvRows(src: string): string[][] {
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
  return rows;
}

/** CSV with its first row as headers. */
export function parseCsv(src: string): RawTab {
  const [headers = [], ...rows] = parseCsvRows(src);
  return { headers, rows };
}
