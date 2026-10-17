import { createHash, timingSafeEqual } from "node:crypto";
import { ATTRIBUTION, normalize } from "./national-leads.mjs";

export const CATALOGUE_ATTRIBUTION = `${ATTRIBUTION}; © OpenStreetMap contributors`;
const ACTOR = "pomovi:self-signup";
const SIGNUP_STAGES = ["demo_requested", "demo_ready"];
const AUTOMATIC_STAGES = ["shortlisted", ...SIGNUP_STAGES];

export class PomoviSignupError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function pomoviJson(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Independent of Google sessions. Refuse before opening the catalogue/database. */
export function authorizePomovi(request, token = process.env.POMOVI_INBOUND_TOKEN) {
  if (!token?.trim()) return pomoviJson({ error: "not found" }, 404);
  const supplied = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? "";
  const digest = (value) => createHash("sha256").update(value).digest();
  if (!supplied || !timingSafeEqual(digest(supplied), digest(token))) {
    const response = pomoviJson({ error: "unauthorized" }, 401);
    response.headers.set("WWW-Authenticate", "Bearer");
    return response;
  }
  return null;
}

/** Validate before loading the index; ref is the trusted server's exact lookup. */
export function catalogueQuery({ q = "", municipality = "", ref = "" } = {}) {
  if (ref) {
    if (q || municipality || typeof ref !== "string" || ref.length > 200 || ref.trim() !== ref) {
      throw new PomoviSignupError("invalid catalogue reference");
    }
    return { ref, q: "", municipality: "" };
  }
  const name = normalize(q);
  const town = normalize(municipality);
  if (name.length < 3 || name.length > 80 || town.length > 100) {
    throw new PomoviSignupError("name must have 3–80 characters; municipality at most 100");
  }
  return { q: name, municipality: town, ref: "" };
}

/** HTTP(S) identity links only; rejected/directory candidates are never suggested. */
function website(index, i) {
  const venue = index.venue(i);
  let url = "", status = "none";
  if (venue.status === "verified") {
    url = index.websiteOverrides.get(venue.id) ?? venue.verified_url;
    status = "verified";
    // An overlay without its approved URL is not proof of the candidate's URL.
    if (!url) { url = venue.candidate_url; status = "candidate"; }
  } else if (["unchecked", "unresolved", "unreachable"].includes(venue.status)) {
    url = venue.candidate_url; status = "candidate";
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return { website: parsed.href, website_status: status };
  } catch { return { website: null, website_status: "none" }; }
}

/** Prefix search over the existing name permutation: no second catalogue store. */
/** Whether `q` occurs in `name` at the start of a word, at or after `from`. */
function wordStartAt(name, q, from) {
  for (let at = from; at >= 0; at = name.indexOf(q, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(name[at - 1])) return true;
  }
  return false;
}

export function searchPomoviCatalogue(index, query) {
  const c = index.columns;
  const result = (i) => ({
    ref: c.id[i], name: c.name[i], address: c.address[i], municipality: c.municipality[i],
    province: c.province[i], region: c.region[i], ...website(index, i),
  });
  if (query.ref) {
    const i = index.indexOf(query.ref);
    return { results: i < 0 ? [] : [result(i)], attribution: CATALOGUE_ATTRIBUTION };
  }
  const order = index.sorted("name", "asc");
  let lo = 0, hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.sortName[order[mid]] < query.q) lo = mid + 1; else hi = mid;
  }
  const results = [];
  const inTown = (i) => !query.municipality || normalize(c.municipality[i]) === query.municipality;
  for (let k = lo; k < order.length && results.length < 10; k++) {
    const i = order[k];
    if (!index.sortName[i].startsWith(query.q)) break;
    if (inTown(i)) results.push(result(i));
  }
  // Then names with a later word starting with the query: a place known in town
  // as «Giardinetto» is listed as «Al Giardinetto …». Word starts only, never an
  // arbitrary substring; whole-name prefixes stay first.
  for (let k = 0; k < order.length && results.length < 10; k++) {
    const i = order[k], name = index.sortName[i];
    const at = name.indexOf(query.q, 1);
    if (at < 0 || name.startsWith(query.q)) continue;
    if (!wordStartAt(name, query.q, at) || !inTown(i)) continue;
    results.push(result(i));
  }
  return { results, attribution: CATALOGUE_ATTRIBUTION };
}

export function signupNotification(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["ref", "signup_id", "stage"].includes(key))
      || typeof input.ref !== "string" || !input.ref || input.ref.length > 200 || input.ref.trim() !== input.ref
      || !Number.isSafeInteger(input.signup_id) || input.signup_id < 1 || !SIGNUP_STAGES.includes(input.stage)) {
    throw new PomoviSignupError("expected ref, positive signup_id, and demo_requested or demo_ready stage");
  }
  return { ref: input.ref, signup_id: input.signup_id, stage: input.stage };
}

/**
 * One transaction, no migration: INSERT's unique conflict and the row lock serialize
 * concurrent deliveries. A deterministic system note is the idempotency record.
 * Signup notifications advance demo stages only; operator sales stages remain theirs.
 */
export async function recordPomoviSignup(sql, index, input) {
  const notification = signupNotification(input);
  const { ref, signup_id: signupId, stage } = notification;
  const i = index.indexOf(ref);
  if (i < 0) throw new PomoviSignupError("unknown venue", 404);
  const note = `self-signup:${signupId}:${stage}`;
  return sql.begin(async (tx) => {
    const [added] = await tx`INSERT INTO pipeline (venue_id, venue_name, municipality, province, stage)
      VALUES (${ref}, ${index.columns.name[i]}, ${index.columns.municipality[i]}, ${index.columns.province[i]}, ${stage})
      ON CONFLICT (venue_id) DO NOTHING RETURNING venue_id`;
    const [current] = await tx`SELECT stage FROM pipeline WHERE venue_id = ${ref} FOR UPDATE`;
    if (current.stage === "do_not_contact") throw new PomoviSignupError("venue is marked do not contact", 409);
    const [previous] = await tx`SELECT id FROM pipeline_events
      WHERE venue_id = ${ref} AND kind = 'note' AND created_by = ${ACTOR} AND note = ${note} LIMIT 1`;
    if (previous) return { stage: current.stage, duplicate: true };
    const currentRank = AUTOMATIC_STAGES.indexOf(current.stage);
    const next = currentRank >= 0 && AUTOMATIC_STAGES.indexOf(stage) > currentRank ? stage : current.stage;
    if (added || next !== current.stage) {
      await tx`INSERT INTO pipeline_events (venue_id, kind, stage_from, stage_to, created_by)
        VALUES (${ref}, 'stage', ${added ? null : current.stage}, ${next}, ${ACTOR})`;
    }
    await tx`INSERT INTO pipeline_events (venue_id, kind, note, created_by)
      VALUES (${ref}, 'note', ${note}, ${ACTOR})`;
    await tx`UPDATE pipeline SET stage = ${next}, updated_at = now() WHERE venue_id = ${ref}`;
    return { stage: next, duplicate: false };
  });
}
