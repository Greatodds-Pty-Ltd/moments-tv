import { redirect } from "next/navigation";
import { signInAction } from "@/lib/actions";
import { auth, isEmployeeEmail } from "@/auth";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That Google account isn't authorised.",
};

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Moments TV" };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  // Only same-site paths, so the sign-in can't be used to bounce people elsewhere.
  const next = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";
  const session = await auth().catch(() => null); // misconfigured auth shows the button, not a crash
  if (isEmployeeEmail(session?.user?.email)) redirect(next);
  const message = error ? (ERROR_MESSAGES[error] ?? "Something went wrong signing in. Please try again.") : null;

  return (
    <div className="login-page">
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-white.png" alt="Sportingbet" className="logo" />
        <h1>Moments that Matter</h1>
        <p>Office TV display. Sign in with your work Google account.</p>
        {message && (
          <div className="err" role="alert">
            {message}
          </div>
        )}
        <form action={signInAction.bind(null, next)}>
          <button type="submit">
            <GoogleIcon /> Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20.5H24v7h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5-5C33.6 6.5 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.3-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l5.7 4.2C13.6 15.5 18.4 12.5 24 12.5c3.1 0 5.9 1.2 8 3.1l5-5C33.6 6.5 29 4.5 24 4.5c-7.5 0-13.9 4.3-17.1 10.6z" />
      <path fill="#4CAF50" d="M24 43.5c5 0 9.6-1.9 13-5.1l-6-4.9c-1.9 1.5-4.4 2.4-7 2.4-5.3 0-9.7-3.4-11.3-8l-5.9 4.5C10 39 16.5 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20.5H24v7h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6 4.9c3.5-3.2 5.8-8 5.8-14 0-1.2-.1-2.3-.3-3.5z" />
    </svg>
  );
}
