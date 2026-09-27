import { REGIONS } from "@rf/map-constants.mjs";
import { CrmError, pipelineEntry, pipelineList, recordPomovi, STAGES, updatePipeline } from "@/lib/crm";
import { db } from "@/lib/db";
import { leadIndex, overlayChanged } from "@/lib/leads";
import { createDemo, listBridged, pomoviConfigured } from "@/lib/pomovi";
import { currentEmail, unauthorized } from "@/lib/session";

// The sales pipeline API used by the venue card and the Pipeline tab of ui/map.html.
//   GET  venue?id=VENUE_ID    the venue's pipeline row and its events
//   GET  list?stage=a,b       the pipeline, next actions first
//   POST venue                add to the pipeline / change stage / next action / add a touch
//   POST demo                 create the venue's demo in Pomovi
//   POST pomovi-refresh       read every bridged venue's demo state from Pomovi

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Params) {
  if (!(await currentEmail())) return unauthorized();
  const route = (await params).path.join("/");
  const query = new URL(request.url).searchParams;
  if (route === "venue") return Response.json(await pipelineEntry(String(query.get("id") || "")));
  if (route === "list") {
    const stages = String(query.get("stage") || "").split(",").filter((stage) => STAGES.includes(stage));
    return Response.json({ items: await pipelineList(await leadIndex(), stages) });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: Params) {
  const email = await currentEmail();
  if (!email) return unauthorized();
  const route = (await params).path.join("/");
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    if (route !== "pomovi-refresh") return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const index = await leadIndex();
    if (route === "venue") {
      const result = await updatePipeline(index, body, email);
      overlayChanged();
      return Response.json(result);
    }
    if (route === "demo") return Response.json(await requestDemo(index, String(body.venue_id || ""), email));
    if (route === "pomovi-refresh") {
      const venues = await listBridged();
      for (const venue of venues) await recordPomovi(venue, email);
      overlayChanged();
      return Response.json({ refreshed: venues.length });
    }
  } catch (error) {
    if (error instanceof CrmError) return Response.json({ error: error.message }, { status: 400 });
    if (!pomoviConfigured() && route !== "venue") return Response.json({ error: (error as Error).message }, { status: 503 });
    if (route !== "venue") return Response.json({ error: (error as Error).message }, { status: 502 });
    throw error;
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

// Sends the lead to Pomovi and records the answer. A venue not yet in the pipeline
// is added; the stage moves to "demo requested" unless it is already further on.
async function requestDemo(index: Awaited<ReturnType<typeof leadIndex>>, venueId: string, email: string) {
  const i = index.indexOf(venueId);
  if (i < 0) throw new CrmError("unknown venue");
  const venue = index.venue(i)!;
  const website = venue.verified_url || venue.candidate_url;
  if (!website) throw new CrmError("this venue has no website to build a demo from");
  const { entry } = await pipelineEntry(venueId);
  if (entry?.stage === "do_not_contact") throw new CrmError("this venue is marked do not contact");
  const [detail] = await db()`SELECT detail->'source_ids' AS ids FROM venue_details WHERE venue_id = ${venueId}`;
  const bridged = await createDemo({
    source_ref: venueId, name: venue.name, category: venue.category, address: venue.address,
    municipality: venue.municipality, province: venue.province, region: REGIONS[venue.region as keyof typeof REGIONS] ?? venue.region,
    phone: venue.phone, website_url: website, website_status: venue.verified_url ? "verified" : "candidate",
    latitude: venue.lat, longitude: venue.lon,
    source_snapshot: { source_ids: detail?.ids ?? [], lead_status: venue.status, map_version: index.baseVersion,
      sent_at: new Date().toISOString() },
  });
  if (!entry) await updatePipeline(index, { venue_id: venueId, stage: "demo_requested" }, email);
  else if (entry.stage === "shortlisted") await updatePipeline(index, { venue_id: venueId, stage: "demo_requested" }, email);
  await updatePipeline(index, { venue_id: venueId, event: { kind: "note",
    note: `Demo ${bridged.created === false ? "already existed" : "created"} in Pomovi: ${bridged.slug}` } }, email);
  await recordPomovi(bridged, email);
  overlayChanged();
  return { pomovi: bridged, ...(await pipelineEntry(venueId)) };
}
