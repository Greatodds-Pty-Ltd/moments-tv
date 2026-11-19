import { NextResponse } from "next/server";
import { auth, isEmployeeEmail } from "@/auth";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// For planners and whoever runs the TV: is the sheet reading cleanly, and which
// rows were skipped? Add ?refresh=1 to re-read the sheet now.
export async function GET(req: Request) {
  if (!isEmployeeEmail((await auth())?.user?.email)) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const s = await getSnapshot({ force });
    return NextResponse.json(
      {
        ok: !s.lastError,
        source: s.source,
        updatedAt: s.updatedAt,
        checkedAt: s.checkedAt,
        lastError: s.lastError,
        counts: { events: s.data.events.length, campaigns: s.data.campaigns.length, images: s.data.images.length },
        week1Start: s.data.settings.week1Start,
        problems: s.problems,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, lastError: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
