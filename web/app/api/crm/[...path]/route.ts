import { REGIONS } from "@rf/map-constants.mjs";
import {
  createContact, CrmInputError, deleteContact, deleteView, listActivities, listContacts, savedViews, saveView,
  updateContact,
} from "@rf/crm-records.mjs";
import { parseFilters } from "@rf/national-leads.mjs";
import { CrmError, pipelineEntry, pipelineList, recordPomovi, STAGES, updatePipeline } from "@/lib/crm";
import { db } from "@/lib/db";
import { leadIndex, NoSnapshotError, overlayChanged } from "@/lib/leads";
import { createDemo, listBridged, pomoviConfigured } from "@/lib/pomovi";
import { venueRecord } from "@/lib/record";
import { currentEmail, unauthorized } from "@/lib/session";

// The CRM API: the pipeline (venue card and Pipeline tab of ui/map.html) and the CRM
// views (web/app/(crm)/…).
//   GET    venue?id=VENUE_ID     the venue's pipeline row and its events
//   GET    list?stage=a,b        the pipeline, next actions first
//   GET    leads?<map filters>&due&contacts&sort&dir&offset&limit   the leads table
//   GET    record?id=VENUE_ID    everything the venue record page shows
//   GET    contacts?q&sort&due&cursor                             the contacts table
//   GET    activities?kind&from&to&stage&venue&cursor             the activity log
//   GET    views?page=leads|contacts|activities                   saved views
//   POST   venue                 add to the pipeline / change stage / next action / add a touch
//   POST   contact               add a contact to a venue ({ venue_id, ...fields })
//   POST   contact/ID            change a contact
//   DELETE contact/ID?reason=request|retention|mistake             erase a contact
//   POST   view                  save a view ({ page, name, query }); DELETE view/ID
//   POST   demo                  create the venue's demo in Pomovi
//   POST   pomovi-refresh        read every bridged venue's demo state from Pomovi

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };
type Index = Awaited<ReturnType<typeof leadIndex>>;

export async function GET(request: Request, { params }: Params) {
  if (!(await currentEmail())) return unauthorized();
  const route = (await params).path.join("/");
  const query = new URL(request.url).searchParams;
  const list = (name: string) => String(query.get(name) || "").split(",").map((v) => v.trim()).filter(Boolean);
  return answer(async () => {
    const sql = db();
    if (route === "venue") return pipelineEntry(String(query.get("id") || ""));
    if (route === "list") {
      const stages = list("stage").filter((stage) => STAGES.includes(stage));
      return { items: await pipelineList(await leadIndex(), stages) };
    }
    if (route === "leads") {
      const index = await leadIndex();
      return index.table(parseFilters(query), { sort: query.get("sort") || undefined, dir: query.get("dir") || undefined,
        offset: int(query.get("offset"), 0), limit: int(query.get("limit"), 100) });
    }
    if (route === "record") return venueRecord(await leadIndex(), String(query.get("id") || ""));
    if (route === "contacts") {
      return listContacts(sql, { q: query.get("q") || "", sort: query.get("sort") || "name",
        cursor: query.get("cursor") || "", due: query.get("due") === "1" });
    }
    if (route === "activities") {
      return listActivities(sql, { kinds: list("kind"), stages: list("stage"), from: query.get("from") || "",
        to: query.get("to") || "", venueId: query.get("venue") || "", cursor: query.get("cursor") || "" });
    }
    if (route === "views") return { items: await savedViews(sql, query.get("page")) };
    return null;
  });
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
  const bridged = route === "demo" || route === "pomovi-refresh";
  try {
    const index = await leadIndex();
    const sql = db();
    if (route === "venue") {
      const result = await updatePipeline(index, body, email);
      overlayChanged();
      return Response.json(result);
    }
    if (route === "contact") {
      const i = index.indexOf(String(body.venue_id || ""));
      if (i < 0) throw new CrmError("unknown venue");
      const venue = index.venue(i)!;
      const contact = await createContact(sql, { id: venue.id, name: venue.name, municipality: venue.municipality,
        province: venue.province }, body, email);
      overlayChanged();
      return Response.json({ contact });
    }
    const contactRoute = route.match(/^contact\/(\d+)$/);
    if (contactRoute) {
      const contact = await updateContact(sql, contactRoute[1], body, email);
      overlayChanged();
      return Response.json({ contact });
    }
    if (route === "view") return Response.json({ view: await saveView(sql, body, email) });
    if (route === "demo") return Response.json(await requestDemo(index, String(body.venue_id || ""), email));
    if (route === "pomovi-refresh") {
      const venues = await listBridged();
      for (const venue of venues) await recordPomovi(venue, email);
      overlayChanged();
      return Response.json({ refreshed: venues.length });
    }
  } catch (error) {
    if (error instanceof CrmError || error instanceof CrmInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NoSnapshotError) return Response.json({ error: error.message }, { status: 503 });
    if (bridged) return Response.json({ error: (error as Error).message }, { status: pomoviConfigured() ? 502 : 503 });
    throw error;
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: Params) {
  const email = await currentEmail();
  if (!email) return unauthorized();
  const route = (await params).path.join("/");
  const query = new URL(request.url).searchParams;
  return answer(async () => {
    const contact = route.match(/^contact\/(\d+)$/);
    if (contact) {
      const result = await deleteContact(db(), contact[1], String(query.get("reason") || ""), email);
      overlayChanged();
      return result;
    }
    const view = route.match(/^view\/(\d+)$/);
    if (view) return deleteView(db(), view[1]);
    return null;
  });
}

// Runs a handler; null means "no such route", input errors are 400s.
async function answer(handler: () => Promise<unknown>) {
  try {
    const result = await handler();
    if (result === null) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CrmError || error instanceof CrmInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NoSnapshotError) return Response.json({ error: error.message }, { status: 503 });
    throw error;
  }
}

function int(value: string | null, fallback: number) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

// Sends the lead to Pomovi and records the answer. A venue not yet in the pipeline
// is added; the stage moves to "demo requested" unless it is already further on.
async function requestDemo(index: Index, venueId: string, email: string) {
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
