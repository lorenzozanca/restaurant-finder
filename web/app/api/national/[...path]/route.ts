import { buildReviewDecision } from "@rf/review-decision.mjs";
import { parseBbox, parseFilters } from "@rf/national-leads.mjs";
import { registrableDomain } from "@rf/publisher-ownership.mjs";
import { db } from "@/lib/db";
import { leadIndex, NoSnapshotError, overlayChanged } from "@/lib/leads";
import { pomoviConfigured } from "@/lib/pomovi";
import { venueReview } from "@/lib/review";
import { currentEmail, unauthorized } from "@/lib/session";

// The national lead map API, the same routes and answers as ui/server.mjs on the
// laptop, served from the snapshot in the online database. Manual reviews are stored
// in manual_reviews and reach the national store on the next sync-online.mjs.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Params) {
  const email = await currentEmail();
  if (!email) return unauthorized();
  let index;
  try {
    index = await leadIndex();
  } catch (error) {
    if (error instanceof NoSnapshotError) return Response.json({ error: error.message }, { status: 503 });
    throw error;
  }
  const route = (await params).path.join("/");
  const url = new URL(request.url);
  const query = url.searchParams;
  const filters = parseFilters(query);
  const bbox = parseBbox(query.get("bbox"));
  if (route === "meta") {
    return json({ ...index.meta(), building: false, crm: { user: email, pomovi: pomoviConfigured() } });
  }
  const tile = route.match(/^tile\/(\d{1,2})\/(\d+)\/(\d+)$/);
  if (tile) {
    const [z, x, y] = tile.slice(1).map(Number);
    if (z > 22 || x >= 2 ** z || y >= 2 ** z) return Response.json({ error: "invalid tile" }, { status: 400 });
    // private: tiles carry lead data, so no shared cache may keep them.
    const cache = query.get("v") === index.version ? "private, max-age=86400, immutable" : "no-cache";
    return json(index.tile(filters, z, x, y), cache);
  }
  if (route === "summary") return json(index.summary(filters, bbox));
  if (route === "list") {
    const offset = Math.max(0, Number.parseInt(query.get("offset") ?? "", 10) || 0);
    const limit = Number.parseInt(query.get("limit") ?? "", 10) || 50;
    return json(index.list(filters, bbox, offset, limit));
  }
  const venue = route.match(/^venue\/(\d+)$/);
  if (venue) {
    if (query.get("v") && query.get("v") !== index.version) return mapUpdated(index.version);
    const detail = index.venue(Number(venue[1]));
    return detail ? json(detail) : Response.json({ error: "venue not found" }, { status: 404 });
  }
  const review = route.match(/^review\/(\d+)$/);
  if (review) {
    if (query.get("v") && query.get("v") !== index.version) return mapUpdated(index.version);
    const detail = index.venue(Number(review[1]));
    if (!detail) return Response.json({ error: "venue not found" }, { status: 404 });
    return json(await venueReview(detail.id));
  }
  if (route === "locate") {
    const place = index.locate(query.get("name") || "", query.get("prov") || "");
    return place ? json(place) : Response.json({ error: "municipality not found" }, { status: 404 });
  }
  if (route === "towns") return json({ v: index.version, towns: index.towns() });
  if (route === "export.csv") {
    const sample = Math.max(0, Number.parseInt(query.get("sample") ?? "", 10) || 0);
    const rows = index.exportRows(filters, bbox, sample, query.get("seed") || "");
    const name = `venues-${new Date().toISOString().slice(0, 10)}-${rows.length}.csv`;
    // Streamed: Vercel refuses a buffered response above 4.5 MB (all of Italy is ~42 MB).
    const chunks = index.csvChunks(rows);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.next();
        if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value));
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

// A manual ownership decision from the venue card. It is validated exactly like the
// laptop's (buildReviewDecision) and against the venue's stored candidates, then
// queued; the map shows it at once through the overlay.
export async function POST(request: Request, { params }: Params) {
  const email = await currentEmail();
  if (!email) return unauthorized();
  if ((await params).path.join("/") !== "review") return Response.json({ error: "not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  let decision;
  try {
    decision = buildReviewDecision(body);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  const sql = db();
  const [row] = await sql`SELECT detail FROM venue_details WHERE venue_id = ${decision.venueId}`;
  const candidates: { domain: string }[] = row?.detail?.candidates ?? [];
  if (!candidates.some((candidate) => candidate.domain === decision.candidateDomain)) {
    return Response.json({ error: "review decision domain is not a stored candidate for this venue" }, { status: 400 });
  }
  const stored = {
    venue_id: decision.venueId, candidate_domain: decision.candidateDomain, decision: String(body.decision),
    website_url: decision.attestation.website_url, evidence_urls: decision.attestation.evidence_urls,
    reviewer: decision.attestation.reviewer, notes: decision.attestation.notes,
  };
  await sql`INSERT INTO manual_reviews (venue_id, candidate_domain, decision, body, decided_by)
    VALUES (${decision.venueId}, ${decision.candidateDomain}, ${stored.decision}, ${sql.json(stored)}, ${email})`;
  overlayChanged();
  return Response.json({ status: decision.attestation.status,
    publisher_domain: registrableDomain(decision.attestation.website_url), pending_sync: true });
}

function json(data: unknown, cacheControl = "no-cache") {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
}

function mapUpdated(version: string) {
  return Response.json({ error: "map updated", v: version }, { status: 409 });
}
