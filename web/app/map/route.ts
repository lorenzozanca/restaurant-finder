import { readFile } from "node:fs/promises";
import path from "node:path";
import { after } from "next/server";
import { leadIndex } from "@/lib/leads";
import { currentEmail } from "@/lib/session";

// The map (/map) is ui/map.html, the same page the laptop's ui/server.mjs serves; it
// finds the CRM features through /api/national/meta. scripts/copy-ui.mjs copies it
// here. The app opens on the Leads table: next.config.ts redirects / to /leads.
export const dynamic = "force-dynamic";

let page: Promise<string> | null = null;

export async function GET(request: Request) {
  if (!(await currentEmail())) return Response.redirect(new URL("/signin", request.url), 302);
  // Start loading the lead index (a few seconds on a cold instance) while the phone
  // fetches the page, Leaflet and the map tiles; the map's first API call then waits
  // on the same load instead of starting it.
  after(() => leadIndex().then(() => undefined, () => undefined));
  page ??= readFile(path.join(process.cwd(), "generated", "map.html"), "utf8");
  return new Response(await page, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
