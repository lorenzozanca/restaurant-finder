import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowed } from "@/lib/access";

// Google is the only sign-in method, and only the addresses in AUTH_OWNER_EMAILS
// get in (the same pattern as the sibling bh-os). There is no sign-up and no user
// administration.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  debug: process.env.AUTH_DEBUG === "1",
  callbacks: {
    // A string redirects instead of failing with a bare "AccessDenied", so the
    // sign-in page can say which account was refused.
    signIn: ({ user }) => {
      if (isAllowed(user.email)) return true;
      const params = new URLSearchParams({ error: "AccessDenied", account: user.email ?? "(no email from Google)" });
      return `/signin?${params}`;
    },
  },
});
