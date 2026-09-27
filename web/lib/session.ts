import "server-only";
import { auth } from "@/auth";
import { devEmail, isAllowed } from "@/lib/access";

/**
 * The signed-in, allowed user's email, or null. Every route that reads or writes
 * data calls this; the proxy is only an optimistic first check. The allow-list is
 * checked again here, so removing an address locks it out at once, even with a
 * session that is still valid.
 */
export async function currentEmail(): Promise<string | null> {
  const dev = devEmail();
  if (dev) return dev;
  const session = await auth();
  const email = session?.user?.email ?? null;
  return isAllowed(email) ? email : null;
}

export function unauthorized() {
  return Response.json({ error: "sign in first" }, { status: 401 });
}
