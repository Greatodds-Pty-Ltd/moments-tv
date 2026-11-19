import { NextResponse } from "next/server";
import { auth, isEmployeeEmail } from "@/auth";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// What the TV page polls. Never 500s while there is last-good data to serve.
export async function GET() {
  if (!isEmployeeEmail((await auth())?.user?.email)) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const s = await getSnapshot();
    return NextResponse.json(
      { ...s.data, updatedAt: s.updatedAt, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("no data to serve", err);
    return NextResponse.json({ error: "No calendar data yet." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
