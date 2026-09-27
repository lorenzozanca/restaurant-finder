import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentEmail } from "@/lib/session";

// The map is ui/map.html, the same page the laptop's ui/server.mjs serves; it finds
// the CRM features through /api/national/meta. scripts/copy-ui.mjs copies it here.
export const dynamic = "force-dynamic";

let page: Promise<string> | null = null;

export async function GET(request: Request) {
  if (!(await currentEmail())) return Response.redirect(new URL("/signin", request.url), 302);
  page ??= readFile(path.join(process.cwd(), "generated", "map.html"), "utf8");
  return new Response(await page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
