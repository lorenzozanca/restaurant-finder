import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { devEmail } from "@/lib/access";

/**
 * The optimistic check Next recommends: no session cookie, no page. The real guard
 * is currentEmail() in lib/session.ts, which every data route calls.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  if (devEmail()) return NextResponse.next();
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/signin", request.url));
}

export const config = {
  matcher: ["/((?!signin|api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|icon.svg|apple-icon.png).*)"],
};
