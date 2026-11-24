import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FatalSheetError, imageKey, normalize, parseCsv, parseCsvRows, parseTvDates, toIsoDate, toTime, week1From, type Cell, type MasterTabs } from "../src/lib/calendar";

const dir = join(__dirname, "..", "sheet-template");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const master = (): MasterTabs => ({
  calendar: parseCsvRows(read("calendar.csv")),
  briefs: parseCsvRows(read("briefs.csv")),
  images: parseCsv(read("tv-images.csv")),
});

const HEAD = ["Week", "Dates", "Event", "Sport", "Why it matters to our FANs", "Job (01)", "Priority", "Brief", "Date status", "Source", "ACQUISITON OPPORTUNITY", "TV dates", "TV title", "TV detail"];
const BRIEFS: Cell[][] = [["Priority A briefs"], ["Field", "A1: Boks November finale", "A2: Black Friday"], ["Single-minded message", "Every Bok moment", "Best week"], ["Offer (04 only)", "SECRET OFFER", "SECRET OFFER"]];
const row = (o: Partial<Record<string, Cell>>): Cell[] =>
  HEAD.map((h) => o[h] ?? (h === "Why it matters to our FANs" ? "private reasoning" : h === "ACQUISITON OPPORTUNITY" ? "private plan" : ""));
const boks = row({ Week: "W2 (23–29 Nov)", Event: "Nations final", Sport: "Rugby", Priority: "A", Brief: "A1", "Date status": "Confirmed", "TV dates": "2026-11-29 18:40", "TV title": "France v Springboks" });
const cal = (...rows: Cell[][]): Cell[][] => [["Moments Campaign Calendar: rolling 12 weeks, refreshed 23 Nov 2026"], [], [], HEAD, boks, ...rows];
const run = (...rows: Cell[][]) => normalize({ calendar: cal(...rows), briefs: BRIEFS });

describe("the local copy of the master", () => {
  it("loads cleanly with no problems", () => {
    const { data, problems } = normalize(master());
    expect(problems).toEqual([]);
    expect(data.events.length).toBeGreaterThan(66); // multi-date rows expand
    expect(data.campaigns.map((c) => c.id)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(data.settings).toEqual({ week1Start: "2026-11-16", refreshed: "2026-11-23" });
  });

  it("builds campaign windows from the linked calendar rows", () => {
    const { campaigns } = normalize(master()).data;
    const a3 = campaigns.find((c) => c.id === "A3")!;
    expect(a3.message).toMatch(/^The summer's biggest series/);
    expect(a3.segments).toEqual([
      { start: "2026-12-17", end: "2026-12-21", main: true, label: "" },
      { start: "2026-12-26", end: "2026-12-30", main: true, label: "" },
      { start: "2027-01-03", end: "2027-01-07", main: true, label: "" },
      { start: "2027-01-10", end: "2027-01-10", main: false, label: "Tail" },
    ]);
    const a4 = campaigns.find((c) => c.id === "A4")!;
    expect(a4.segments.slice(0, 2).map((s) => s.label)).toEqual(["Pre-roll", "Pre-roll"]);
    // context rows (payday, public holiday) never become campaign windows
    expect(campaigns.find((c) => c.id === "A2")!.segments).toEqual([{ start: "2026-11-27", end: "2026-11-27", main: true, label: "" }]);
  });

  it("maps the master's columns onto TV events", () => {
    const evs = normalize(master()).data.events;
    expect(evs.find((e) => e.title === "France v Springboks")).toEqual({
      start: "2026-11-29",
      end: "2026-11-29",
      time: "18:40",
      title: "France v Springboks",
      sport: "Rugby",
      priority: "A",
      toConfirm: false,
      detail: "Nations Championship final, Twickenham",
      campaignId: "A1",
    });
    expect(evs.find((e) => e.title === "Carling Knockout final")).toMatchObject({ sport: "Football", toConfirm: true, campaignId: "A5" });
    expect(evs.find((e) => e.title === "Black Friday")!.sport).toBe("Casino");
    expect(evs.find((e) => e.title === "Month-end payday")!.priority).toBe("X");
    expect(evs.find((e) => e.title === "SA20 Season 5")).toMatchObject({ start: "2027-01-17", end: "2027-02-21", time: "15:30", priority: "B" });
    expect(evs.filter((e) => e.title === "CAF CL: Orlando Pirates")).toHaveLength(6);
  });
});

describe("only the TV columns are read", () => {
  it("never copies other columns or brief fields into the data", () => {
    const json = JSON.stringify(run().data);
    expect(json).not.toMatch(/private|SECRET/);
  });
});

describe("bad rows are dropped and named", () => {
  it("flags a row with no TV dates", () => {
    const r = run(row({ Event: "Forgotten", Priority: "B" }));
    expect(r.data.events).toHaveLength(1);
    expect(r.problems).toEqual(["Calendar row 6 (Forgotten): no TV dates, not shown on the TV"]);
  });

  it("drops an unknown priority and a bad date entry, keeps the good entries", () => {
    const r = run(
      row({ Event: "Bad", Priority: "Z", "TV dates": "2026-11-30" }),
      row({ Event: "Half", Priority: "C", "TV dates": "2026-12-01; 1 Dec; 2026-02-30; 2026-12-05..2026-12-04" }),
    );
    expect(r.data.events.map((e) => e.title)).toEqual(["France v Springboks", "Half"]);
    expect(r.problems).toHaveLength(4);
    expect(r.problems[0]).toMatch(/row 6 \(Bad\).*priority "Z"/);
  });

  it("ignores a brief id that isn't on the briefs tab", () => {
    const r = run(row({ Event: "Orphan", Priority: "A", Brief: "A9", "TV dates": "2026-12-01" }));
    expect(r.data.events[1].campaignId).toBeNull();
    expect(r.problems[0]).toMatch(/brief A9 isn't on the Priority A briefs tab/);
  });
});

describe("bad tabs are fatal (keep last good data)", () => {
  it("rejects missing tabs, a missing TV dates column and a calendar with nothing to show", () => {
    expect(() => normalize({ briefs: BRIEFS })).toThrow(/Calendar tab is missing/);
    expect(() => normalize({ calendar: cal() })).toThrow(/Priority A briefs tab is missing/);
    const noTv = cal().map((r) => r.slice(0, 11));
    expect(() => normalize({ calendar: noTv, briefs: BRIEFS })).toThrow(/missing column\(s\): tv dates/);
    expect(() => normalize({ calendar: [["#REF!"]], briefs: BRIEFS })).toThrow(FatalSheetError);
    expect(() => normalize({ calendar: [HEAD, row({ Event: "x", Priority: "A" })], briefs: BRIEFS })).toThrow(/no rows the TV can show/);
  });

  it("rejects an unexpected column on the TV images tab", () => {
    expect(() =>
      normalize({ calendar: cal(), briefs: BRIEFS, images: { headers: ["match_type", "match_value", "image_file", "owner"], rows: [] } }),
    ).toThrow(/unexpected column: "owner"/);
  });
});

describe("values", () => {
  it("parses TV dates", () => {
    const p: string[] = [];
    expect(parseTvDates("2026-11-29 18:40; 2026-12-01..2026-12-03\n2027-01-17 15:30..2027-02-21", "x", p)).toEqual([
      { start: "2026-11-29", end: "2026-11-29", time: "18:40" },
      { start: "2026-12-01", end: "2026-12-03", time: null },
      { start: "2027-01-17", end: "2027-02-21", time: "15:30" },
    ]);
    expect(parseTvDates(46347, "x", p)).toEqual([{ start: "2026-11-21", end: "2026-11-21", time: null }]);
    expect(parseTvDates("2026-11-29 25:00", "x", p)).toEqual([]);
    expect(p).toHaveLength(1);
  });

  it("works out W1 from the Week column, across the year end", () => {
    expect(week1From("W2 (23–29 Nov)", "2026-11-23")).toBe("2026-11-16");
    expect(week1From("W7 (28 Dec–3 Jan)", "2026-11-23")).toBe("2026-11-16");
    expect(week1From("W2 (4–10 Jan)", "2026-12-30")).toBe("2026-12-28");
    expect(week1From("W1–W3", "2026-11-23")).toBeNull();
  });

  it("reads date serials and time fractions", () => {
    expect(toIsoDate(46347)).toBe("2026-11-21");
    expect(toTime(18 / 24 + 40 / 1440)).toBe("18:40");
    expect(toTime("9:05")).toBe("09:05");
    expect(toTime("25:00")).toBeNull();
  });

  it("skips placeholder image rows and strips folders from file names", () => {
    const { data } = normalize({
      calendar: cal(),
      briefs: BRIEFS,
      images: { headers: ["match_type", "match_value", "image_file"], rows: [["sport", "Golf", ""], ["Sport", "Rugby", "assets/hero/rugby.jpg"]] },
    });
    expect(data.images).toEqual([{ matchType: "sport", matchValue: "Rugby", file: "rugby.jpg", textInImage: false, useUntil: null }]);
  });
});

describe("images named after the Event (column C)", () => {
  it("matches the file name to the event, ignoring extension, case, spacing and dash/apostrophe styles", () => {
    expect(imageKey("Black Friday.png")).toBe(imageKey("Black Friday"));
    expect(imageKey("black  friday.JPG")).toBe(imageKey("Black Friday"));
    expect(imageKey("Proteas v England, 1st Test, Wanderers.webp")).toBe(imageKey("Proteas v England, 1st Test, Wanderers"));
    expect(imageKey("Investec Champions Cup pool rounds 2-4.jpg")).toBe(imageKey("Investec Champions Cup pool rounds 2–4"));
    expect(imageKey("L’Ormarins King’s Plate, Kenilworth.png")).toBe(imageKey("L'Ormarins King's Plate, Kenilworth"));
    expect(imageKey("Black Friday sale.png")).not.toBe(imageKey("Black Friday"));
  });

  it("returns each row's Event alongside its TV title", () => {
    const { eventNames } = normalize(master());
    expect(eventNames).toContainEqual({ event: "Black Friday", title: "Black Friday" });
    expect(eventNames).toContainEqual({ event: "Nations Championship finals weekend, Twickenham", title: "France v Springboks" });
  });
});
