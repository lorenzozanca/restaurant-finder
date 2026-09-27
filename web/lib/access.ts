/**
 * Who may use the app: the addresses in AUTH_OWNER_EMAILS (comma-separated). An
 * empty list refuses everyone. Kept apart from auth.ts so the proxy and the dev
 * helper can read it without pulling in the Auth.js runtime.
 */
export const allowedEmails = () =>
  (process.env.AUTH_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export function isAllowed(email: string | null | undefined): boolean {
  return Boolean(email) && allowedEmails().includes(String(email).toLowerCase());
}

/**
 * Google's flow needs a real browser, which puts every page out of reach of tests,
 * scripts and agents. AUTH_DEV_EMAIL stands in for a signed-in user locally. It is
 * ignored whenever NODE_ENV=production, which is how Vercel always builds and runs.
 */
export function devEmail(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return process.env.AUTH_DEV_EMAIL?.trim() || null;
}
