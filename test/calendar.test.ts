import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FatalSheetError, normalize, parseCsv, toIsoDate, toTime, type RawTab, type RawTabs } from "../src/lib/calendar";

const dir = join(__dirname, "..", "sheet-template");
const csv = (f: string) => parseCsv(readFileSync(join(dir, f), "utf8"));
const templates = (): RawTabs => ({
  Events: csv("events.csv"),
  Campaigns: csv("campaigns.csv"),
  Images: csv("images.csv"),
  Settings: csv("settings.csv"),
});

const EV_HEAD = ["start_date", "end_date", "time_sast", "title", "sport", "priority", "to_confirm", "detail", "campaign_id"];
const CAMP_HEAD = ["campaign_id", "name", "message", "seg_start", "seg_end", "seg_label", "main_window"];
const camps = (): RawTab => ({ headers: CAMP_HEAD, rows: [["A1", "Boks", "msg", "2026-11-21", "2026-11-21", "Ireland", "TRUE"]] });
const good = ["2026-11-21", "2026-11-21", "18:40", "Ireland v Springboks", "Rugby", "A", "FALSE", "Dublin", "A1"];

describe("templates", () => {
  it("load cleanly with no problems", () => {
    const { data, problems } = normalize(templates());
    expect(problems).toEqual([]);
    expect(data.events).toHaveLength(75);
    expect(data.campaigns.map((c) => c.id)).toEqual(["A1", "A2", "A3", "A4"]);
    expect(data.campaigns[3].segments).toHaveLength(3);
    expect(data.images).toEqual([
      {
        matchType: "event",
        matchValue: "Ireland v Springboks",
        file: "rugby-ireland-v-springboks.jpg",
        textInImage: true,
        useUntil: "2026-11-21",
      },
    ]);
    expect(data.settings.week1Start).toBe("2026-11-16");
  });

  it("keep quoted commas and the Boks row intact", () => {
    const ev = normalize(templates()).data.events.find((e) => e.title === "Ireland v Springboks")!;
    expect(ev).toEqual({
      start: "2026-11-21",
      end: "2026-11-21",
      time: "18:40",
      title: "Ireland v Springboks",
      sport: "Rugby",
      priority: "A",
      toConfirm: false,
      detail: "Aviva Stadium, Dublin. Last Bok pool test of 2026",
      campaignId: "A1",
    });
  });
});

describe("bad rows are dropped, not fatal", () => {
  const run = (...rows: unknown[][]) =>
    normalize({ Events: { headers: EV_HEAD, rows: [good, ...(rows as string[][])] }, Campaigns: camps() });

  it("drops an unknown priority", () => {
    const r = run(["2026-11-22", "", "", "Bad", "Rugby", "Z", "", "", ""]);
    expect(r.data.events).toHaveLength(1);
    expect(r.problems[0]).toMatch(/row 3 \(Bad\).*priority "Z"/);
  });

  it("drops end before start", () => {
    const r = run(["2026-11-22", "2026-11-20", "", "Backwards", "Rugby", "B", "", "", ""]);
    expect(r.data.events).toHaveLength(1);
    expect(r.problems[0]).toMatch(/end_date is before start_date/);
  });

  it("drops unparseable and impossible dates", () => {
    const r = run(["22/11/2026", "", "", "Slashes", "Rugby", "B", "", "", ""], ["2026-02-30", "", "", "Feb 30", "Rugby", "B", "", "", ""]);
    expect(r.data.events).toHaveLength(1);
    expect(r.problems).toHaveLength(2);
  });

  it("keeps an event with a bad time, minus the time", () => {
    const r = run(["2026-11-22", "", "TBC", "No time", "Rugby", "B", "", "", ""]);
    expect(r.data.events[1].time).toBeNull();
    expect(r.problems[0]).toMatch(/time_sast "TBC"/);
  });

  it("unlinks an unknown campaign and skips blank rows silently", () => {
    const r = run(["2026-11-22", "", "", "Orphan", "Rugby", "A", "", "", "Z9"], ["", "", "", "", "", "", "", "", ""]);
    expect(r.data.events[1].campaignId).toBeNull();
    expect(r.problems).toHaveLength(1);
  });

  it("defaults end to start and lower-case priority is accepted", () => {
    const r = run(["2026-11-22", "", "", "One day", "Golf", "b", "yes", "", ""]);
    expect(r.data.events[1]).toMatchObject({ end: "2026-11-22", priority: "B", toConfirm: true });
  });
});

describe("Google Sheets cell types", () => {
  it("reads date serials and time fractions", () => {
    expect(toIsoDate(46347)).toBe("2026-11-21");
    expect(toTime(18 / 24 + 40 / 1440)).toBe("18:40");
    expect(toTime("9:05")).toBe("09:05");
    expect(toTime("25:00")).toBeNull();
  });

  it("reads native booleans", () => {
    const { data } = normalize({
      Events: { headers: EV_HEAD, rows: [[46347, null, 0.7777777, "Serial", "Rugby", "A", true, null, "A1"]] },
      Campaigns: camps(),
    });
    expect(data.events[0]).toMatchObject({ start: "2026-11-21", end: "2026-11-21", time: "18:40", toConfirm: true });
  });
});

describe("bad tabs are fatal (keep last good data)", () => {
  it("rejects a column that isn't TV-safe", () => {
    expect(() =>
      normalize({ Events: { headers: [...EV_HEAD, "Owner"], rows: [[...good, "Brad"]] }, Campaigns: camps() }),
    ).toThrow(/isn't on the TV-safe list: "Owner"/);
  });

  it("rejects data under a blank header but allows empty trailing columns", () => {
    expect(() =>
      normalize({ Events: { headers: [...EV_HEAD, ""], rows: [[...good, "secret note"]] }, Campaigns: camps() }),
    ).toThrow(FatalSheetError);
    expect(normalize({ Events: { headers: [...EV_HEAD, ""], rows: [[...good, ""]] }, Campaigns: camps() }).data.events).toHaveLength(1);
  });

  it("rejects a missing tab, missing column, IMPORTRANGE error and an all-bad Events tab", () => {
    expect(() => normalize({ Events: { headers: EV_HEAD, rows: [good] } })).toThrow(/Campaigns tab is missing/);
    expect(() => normalize({ Events: { headers: EV_HEAD.slice(1), rows: [] }, Campaigns: camps() })).toThrow(/start_date/);
    expect(() => normalize({ Events: { headers: ["#REF!"], rows: [] }, Campaigns: camps() })).toThrow(FatalSheetError);
    expect(() =>
      normalize({ Events: { headers: EV_HEAD, rows: [["x", "", "", "Bad", "", "A", "", "", ""]] }, Campaigns: camps() }),
    ).toThrow(/no valid rows/);
  });
});

describe("images and settings", () => {
  it("skips placeholder image rows and strips folders from file names", () => {
    const { data } = normalize({
      Events: { headers: EV_HEAD, rows: [good] },
      Campaigns: camps(),
      Images: {
        headers: ["match_type", "match_value", "image_file"],
        rows: [
          ["sport", "Golf", ""],
          ["Sport", "Rugby", "assets/hero/rugby.jpg"],
        ],
      },
    });
    expect(data.images).toEqual([{ matchType: "sport", matchValue: "Rugby", file: "rugby.jpg", textInImage: false, useUntil: null }]);
  });

  it("snaps week1_start to its Monday", () => {
    const { data } = normalize({
      Events: { headers: EV_HEAD, rows: [good] },
      Campaigns: camps(),
      Settings: { headers: ["key", "value"], rows: [["week1_start", "2026-11-19"]] },
    });
    expect(data.settings.week1Start).toBe("2026-11-16");
  });
});
