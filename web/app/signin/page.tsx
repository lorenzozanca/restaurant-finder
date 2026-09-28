import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { allowedEmails, devEmail, isAllowed } from "@/lib/access";

export const metadata = { title: "Sign in — restaurant-finder" };

/** Auth.js error codes that reach this page, in plain words. */
const ERRORS: Record<string, string> = {
  AccessDenied: "This Google account is not on the allow-list (AUTH_OWNER_EMAILS).",
  Configuration: "The server is missing AUTH_SECRET, AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET, or one is wrong.",
  OAuthSignin: "Could not build the Google authorization URL.",
  OAuthCallbackError: "Google refused the callback: usually an unauthorized redirect URI or a wrong client secret.",
  OAuthCallback: "Could not handle Google's answer.",
  Callback: "An Auth.js callback failed.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; account?: string }>;
}) {
  if (devEmail()) redirect("/leads");
  const session = await auth();
  if (isAllowed(session?.user?.email)) redirect("/leads");
  const { error, account } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column",
      justifyContent: "center", padding: "0 20px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>restaurant-finder</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Italian venue leads and the sales pipeline. Private.</p>
      {error ? (
        <div role="alert" style={{ border: "1px solid #dc2626", color: "#991b1b", borderRadius: 10, padding: "10px 12px",
          margin: "12px 0", fontSize: 14 }}>
          <b>Sign-in failed — {error}</b>
          <p style={{ margin: "6px 0 0" }}>{ERRORS[error] ?? "Unrecognised error."}</p>
          {account ? <p style={{ margin: "6px 0 0" }}>Account used: <code>{account}</code> · allowed addresses
            configured: {allowedEmails().length}</p> : null}
        </div>
      ) : null}
      <form action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/leads" });
      }}>
        <button type="submit" style={{ width: "100%", height: 46, border: 0, borderRadius: 10, background: "#111827",
          color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
