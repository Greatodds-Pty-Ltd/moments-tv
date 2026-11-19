import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Employees-only, same pattern as BetCheck / dashboards / shortener (shared
// Google OAuth client). Defaults to the company domain when unset.
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || "s-b.co.za")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// One-off extra accounts without opening up a whole domain.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isEmployeeEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").toLowerCase();
  return Boolean(e) && (ALLOWED_EMAILS.includes(e) || ALLOWED_DOMAINS.some((d) => e.endsWith(`@${d}`)));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  // The office TV signs in once with a kiosk account and runs unattended. The
  // page calls /api/data every few minutes, which keeps rolling the session
  // forward (updateAge), so it only lapses if the TV is off for 30 days.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60, updateAge: 12 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ profile }) {
      // The consent screen is External, so this is the only gate.
      if (!profile?.email_verified) return false;
      return isEmployeeEmail(profile.email);
    },
  },
});
