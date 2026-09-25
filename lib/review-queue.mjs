import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { EvidenceStore } from "./evidence-store.mjs";
import { registrableDomain } from "./publisher-ownership.mjs";

const DAY_MS = 86_400_000;
const REVIEW_TTL_MS = 365 * DAY_MS;

// Manual ownership review from the map's venue card, one of the two approved
// verification routes in PROCESS.md. buildReviewDecision validates one decision
// and maps it onto the durable attestation write. Pure: no database access, so the
// UI server and the tests share it.
export function buildReviewDecision(body = {}, options = {}) {
  const venueId = String(body.venue_id || "").trim();
  if (!venueId) throw new Error("review decision requires venue_id");
  const decision = String(body.decision || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(decision)) {
    throw new Error('review decision must be "approve" or "reject"');
  }
  const websiteUrl = String(body.website_url || "").trim();
  if (!websiteUrl) throw new Error("review decision requires website_url");
  const candidateDomain = String(body.candidate_domain || "").trim().toLowerCase();
  if (!candidateDomain) throw new Error("review decision requires candidate_domain");
  if (decision === "reject" && registrableDomain(websiteUrl) !== candidateDomain) {
    throw new Error("review decision website must match the presented candidate domain");
  }
  const rawEvidence = Array.isArray(body.evidence_urls)
    ? body.evidence_urls : String(body.evidence_urls || "").split(/[,\n]/);
  const evidenceUrls = [...new Set(rawEvidence.map((item) => String(item || "").trim()).filter(Boolean))];
  if (evidenceUrls.length === 0) throw new Error("review decision requires at least one evidence URL");
  const reviewer = String(body.reviewer || "").trim();
  if (!reviewer) throw new Error("review decision requires reviewer");
  const method = String(body.method || "manual_first_party_review").trim();
  if (method !== "manual_first_party_review") {
    throw new Error("review queue decisions must use manual_first_party_review");
  }
  const notes = String(body.notes || "").trim();
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error("review decision requires a valid timestamp");
  const reviewedAt = String(body.reviewed_at || now.toISOString());
  const expiresAt = String(body.expires_at
    || new Date(Date.parse(reviewedAt) + REVIEW_TTL_MS).toISOString());
  return {
    venueId, candidateDomain,
    attestation: {
      status: decision === "approve" ? "verified" : "rejected",
      method, venue_id: venueId, website_url: websiteUrl, evidence_urls: evidenceUrls,
      reviewer, reviewed_at: reviewedAt, expires_at: expiresAt,
      notes: notes || undefined, source_kind: "human_review",
      source_fingerprint: String(body.source_fingerprint || "").trim() || undefined,
    },
    reason: "review_queue_decision",
    recordedAt: now.toISOString(),
  };
}

// Records a decision in the national store. An approval publishes the website (the
// attestation plus the accepted website fact the map shows); a rejection records
// only the attestation. The candidate domain must be one the store holds for the venue.
export function recordReviewDecision(dbPath, body, options = {}) {
  const { venueId, candidateDomain, attestation, reason, recordedAt } = buildReviewDecision(body, options);
  const store = new EvidenceStore(dbPath, { clock: () => new Date(recordedAt) });
  try {
    const candidates = venueCandidates(store.db, venueId);
    const candidate = candidates.find((item) => item.domain === candidateDomain);
    if (!candidate) throw new Error("review decision domain is not a stored candidate for this venue");
    if (attestation.status === "verified") {
      return store.publishManuallyVerifiedWebsite(venueId, attestation,
        { reason, recordedAt, candidateUrl: candidate.url });
    }
    return store.recordPublisherAttestation(venueId, attestation, { reason, recordedAt });
  } finally {
    store.close();
  }
}

// Everything a reviewer needs to decide one venue, read without writing: its
// candidate websites, current ownership decisions, crawl assessments, and the
// latest LLM reviewer outcome from the batch review database (if one is given).
export function venueReview(dbPath, venueId, options = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const at = String(options.at || new Date().toISOString());
    const attestations = db.prepare(`SELECT publisher_domain, decision_status, method, attested_website,
        evidence_urls_json, reviewer, reviewed_at, notes FROM publisher_attestations
      WHERE venue_id = ? AND lifecycle_status = 'active' AND reviewed_at <= ? AND expires_at > ?
      ORDER BY reviewed_at DESC`).all(venueId, at, at).map((row) => ({
      domain: row.publisher_domain, status: row.decision_status, method: row.method,
      website: row.attested_website, evidence_urls: parseJson(row.evidence_urls_json, []),
      reviewer: row.reviewer, reviewed_at: row.reviewed_at, notes: row.notes || "",
    }));
    const assessments = db.prepare(`SELECT candidate_url, final_url, assessment_state, crawl_outcome,
        identity_score, geography_score, officialness_score, evidence_json, checked_at
      FROM candidate_assessments WHERE venue_id = ? ORDER BY checked_at DESC`).all(venueId).map((row) => ({
      candidate_url: row.candidate_url, final_url: row.final_url, state: row.assessment_state,
      crawl_outcome: row.crawl_outcome, evidence: parseJson(row.evidence_json, []), checked_at: row.checked_at,
      scores: { identity: row.identity_score, geography: row.geography_score, officialness: row.officialness_score },
    }));
    const candidates = venueCandidates(db, venueId, options.sourceUrl);
    return { venue_id: venueId, candidates, attestations, assessments,
      llm: options.reviewDbPath ? latestLlmOutcome(options.reviewDbPath, venueId) : null };
  } finally {
    db.close();
  }
}

// Candidate websites for one venue, one per registrable domain: the source record
// website (passed in when the caller already knows it, since source_records has no
// venue index) and every active website fact.
function venueCandidates(db, venueId, sourceUrl) {
  if (!db.prepare("SELECT 1 FROM venues WHERE venue_id = ? AND lifecycle_status = 'active'").get(venueId)) return [];
  const rows = [];
  const sources = sourceUrl === undefined
    ? db.prepare(`SELECT json_extract(payload_json, '$.website') AS url, source FROM source_records
        WHERE venue_id = ? AND json_type(payload_json, '$.website') = 'text'`).all(venueId)
    : [{ url: sourceUrl, source: "record" }];
  for (const row of sources) rows.push({ url: String(row.url || "").trim(), origin: `source:${row.source}` });
  for (const row of db.prepare(`SELECT fact_key, decision_status FROM facts WHERE venue_id = ?
      AND kind = 'website' AND lifecycle_status = 'active' ORDER BY fact_id`).all(venueId)) {
    rows.push({ url: row.fact_key, origin: `fact:${row.decision_status}` });
  }
  const byDomain = new Map();
  for (const row of rows) {
    const domain = row.url ? registrableDomain(row.url) : "";
    if (!domain) continue;
    const entry = byDomain.get(domain) || { domain, url: row.url, origins: [] };
    if (!entry.origins.includes(row.origin)) entry.origins.push(row.origin);
    byDomain.set(domain, entry);
  }
  return [...byDomain.values()];
}

function latestLlmOutcome(reviewDbPath, venueId) {
  if (!existsSync(reviewDbPath)) return null;
  const db = new DatabaseSync(reviewDbPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT candidate_url, final_url, outcome, publisher_kind, reasons_json, review_json,
        prompt_version, verifier_model, decided_at FROM llm_review_outcomes
      WHERE venue_id = ? ORDER BY decided_at DESC, outcome_id DESC LIMIT 1`).get(venueId);
    if (!row) return null;
    const verifier = parseJson(row.review_json, {}).verifier || {};
    return {
      candidate_url: row.candidate_url, final_url: row.final_url, outcome: row.outcome,
      publisher_kind: row.publisher_kind, reasons: parseJson(row.reasons_json, []),
      reason: String(verifier.reason || ""),
      quotes: { name: verifier.name_quote || "", municipality: verifier.municipality_quote || "",
        address: verifier.address_quote || "", phone: verifier.phone_quote || "" },
      model: row.verifier_model, prompt_version: row.prompt_version, decided_at: row.decided_at,
    };
  } catch {
    return null; // a review database from another schema: show the card without it
  } finally {
    db.close();
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}
