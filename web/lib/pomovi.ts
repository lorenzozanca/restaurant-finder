import "server-only";

// Client for Pomovi's bridge endpoints (contract: ../pomovi/docs/plans/
// restaurant-finder-bridge.md). Configured by POMOVI_BRIDGE_URL (Pomovi's console
// origin, e.g. https://app.pomovi.com) and POMOVI_BRIDGE_TOKEN; without both, the app
// shows the bridge as not configured and never calls Pomovi.

export type BridgedVenue = {
  source_ref: string;
  pomovi_venue_id: number;
  slug: string;
  status: string;
  public_url?: string | null;
  wizard_url?: string | null;
  menu_items?: number | null;
  created?: boolean;
};

export type DemoRequest = {
  source_ref: string;
  name: string;
  category: string;
  address: string;
  municipality: string;
  province: string;
  region: string;
  phone: string;
  website_url: string;
  website_status: "verified" | "candidate";
  latitude: number;
  longitude: number;
  source_snapshot: Record<string, unknown>;
};

export function pomoviConfigured(): boolean {
  return Boolean(process.env.POMOVI_BRIDGE_URL && process.env.POMOVI_BRIDGE_TOKEN);
}

async function call(path: string, init: RequestInit = {}) {
  if (!pomoviConfigured()) throw new Error("the Pomovi bridge is not configured (POMOVI_BRIDGE_URL, POMOVI_BRIDGE_TOKEN)");
  const base = String(process.env.POMOVI_BRIDGE_URL).replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${process.env.POMOVI_BRIDGE_TOKEN}`,
      "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON: reported below */ }
  if (!response.ok) {
    throw new Error(`Pomovi answered ${response.status}${body.error ? `: ${body.error}` : ""}`);
  }
  return body;
}

/** Creates (or finds, if already bridged) the Pomovi prospect for one lead. */
export async function createDemo(request: DemoRequest): Promise<BridgedVenue> {
  const body = await call("/api/bridge/venues", { method: "POST", body: JSON.stringify(request) });
  return { ...(body as unknown as BridgedVenue), source_ref: request.source_ref };
}

/** Every bridged venue with its demo state. */
export async function listBridged(): Promise<BridgedVenue[]> {
  const body = await call("/api/bridge/venues");
  return Array.isArray(body.venues) ? (body.venues as BridgedVenue[]) : [];
}
