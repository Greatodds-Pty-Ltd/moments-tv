import { NextResponse } from "next/server";
import { auth, isEmployeeEmail } from "@/auth";

// The whole site is employees-only (Next.js 16 proxy, formerly middleware).
export default auth((req) => {
  if (isEmployeeEmail(req.auth?.user?.email)) return NextResponse.next();

  // The TV page's background calls get a 401 (it keeps showing what it has);
  // a person opening a URL in the browser gets the sign-in page.
  const browserVisit = req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");
  if (req.nextUrl.pathname.startsWith("/api/") && !browserVisit) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const signInUrl = new URL("/login", req.nextUrl.origin);
  if (req.nextUrl.pathname !== "/") signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
  return NextResponse.redirect(signInUrl);
});

// Open: the sign-in page and flow, Next's static files and the logo the
// sign-in page shows. Everything else (the TV page, data, images) needs a login.
export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|brand/|favicon.ico|robots.txt).*)"],
};
