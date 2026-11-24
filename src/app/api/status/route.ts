import { NextResponse } from "next/server";
import { auth, isEmployeeEmail } from "@/auth";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// For whoever runs the TV: is the master calendar reading cleanly, when was it
// last refreshed, and which rows were skipped? Add ?refresh=1 to re-read it now.
const CALENDAR_STALE_DAYS = 8; // the calendar is refreshed weekly
export async function GET(req: Request) {
  if (!isEmployeeEmail((await auth())?.user?.email)) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const s = await getSnapshot({ force });
    const refreshed = s.data.settings.refreshed ?? null;
    const ageDays = refreshed ? Math.floor((Date.now() - Date.parse(refreshed)) / 864e5) : null;
    return NextResponse.json(
      {
        ok: !s.lastError,
        source: s.source,
        updatedAt: s.updatedAt,
        checkedAt: s.checkedAt,
        lastError: s.lastError,
        counts: { events: s.data.events.length, campaigns: s.data.campaigns.length, images: s.data.images.length },
        week1Start: s.data.settings.week1Start,
        calendarRefreshed: refreshed,
        calendarStale: ageDays === null || ageDays > CALENDAR_STALE_DAYS,
        problems: s.problems,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, lastError: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
