import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { EvidenceStore } from "./evidence-store.mjs";
import { sourceWebsiteUrl } from "./national-map.mjs";
import { registrableDomain } from "./publisher-ownership.mjs";
import { buildReviewDecision } from "./review-decision.mjs";

export { buildReviewDecision };

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
    const attestations = db.prepare(`${ATTESTATION_SELECT} WHERE venue_id = ? AND lifecycle_status = 'active'
      AND reviewed_at <= ? AND expires_at > ? ORDER BY reviewed_at DESC`).all(venueId, at, at).map(attestationRow);
    const assessments = db.prepare(`${ASSESSMENT_SELECT} WHERE venue_id = ? ORDER BY checked_at DESC`)
      .all(venueId).map(assessmentRow);
    const candidates = venueCandidates(db, venueId, options.sourceUrl);
    return { venue_id: venueId, candidates, attestations, assessments,
      llm: options.reviewDbPath ? latestLlmOutcome(options.reviewDbPath, venueId) : null };
  } finally {
    db.close();
  }
}

// Row shapes shared with the bulk builder for the online app (lib/venue-details.mjs).
export const ATTESTATION_SELECT = `SELECT venue_id, publisher_domain, decision_status, method, attested_website,
  evidence_urls_json, reviewer, reviewed_at, notes FROM publisher_attestations`;
export const ASSESSMENT_SELECT = `SELECT venue_id, candidate_url, final_url, assessment_state, crawl_outcome,
  identity_score, geography_score, officialness_score, evidence_json, checked_at FROM candidate_assessments`;

export function attestationRow(row) {
  return {
    domain: row.publisher_domain, status: row.decision_status, method: row.method,
    website: row.attested_website, evidence_urls: parseJson(row.evidence_urls_json, []),
    reviewer: row.reviewer, reviewed_at: row.reviewed_at, notes: row.notes || "",
  };
}

export function assessmentRow(row) {
  return {
    candidate_url: row.candidate_url, final_url: row.final_url, state: row.assessment_state,
    crawl_outcome: row.crawl_outcome, evidence: parseJson(row.evidence_json, []), checked_at: row.checked_at,
    scores: { identity: row.identity_score, geography: row.geography_score, officialness: row.officialness_score },
  };
}

// Candidate websites for one venue, one per registrable domain: the source record
// website (passed in when the caller already knows it, since source_records has no
// venue index) and every active website fact.
function venueCandidates(db, venueId, sourceUrl) {
  if (!db.prepare("SELECT 1 FROM venues WHERE venue_id = ? AND lifecycle_status = 'active'").get(venueId)) return [];
  const sources = sourceUrl === undefined
    ? db.prepare(`SELECT json_extract(payload_json, '$.website') AS url, source FROM source_records
        WHERE venue_id = ? AND json_type(payload_json, '$.website') = 'text'`).all(venueId)
    : [{ url: sourceUrl, source: "record" }];
  const facts = db.prepare(`SELECT fact_key, decision_status FROM facts WHERE venue_id = ?
      AND kind = 'website' AND lifecycle_status = 'active' ORDER BY fact_id`).all(venueId);
  return candidateList(sources, facts);
}

// sources: [{ url, source }] from source records; facts: [{ fact_key, decision_status }].
export function candidateList(sources, facts) {
  const rows = [];
  for (const row of sources) rows.push({ url: sourceWebsiteUrl(row.url), origin: `source:${row.source}` });
  for (const row of facts) rows.push({ url: row.fact_key, origin: `fact:${row.decision_status}` });
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

export const LLM_OUTCOME_SELECT = `SELECT venue_id, candidate_url, final_url, outcome, publisher_kind,
  reasons_json, review_json, prompt_version, verifier_model, decided_at FROM llm_review_outcomes`;

export function llmOutcomeRow(row) {
  const verifier = parseJson(row.review_json, {}).verifier || {};
  return {
    candidate_url: row.candidate_url, final_url: row.final_url, outcome: row.outcome,
    publisher_kind: row.publisher_kind, reasons: parseJson(row.reasons_json, []),
    reason: String(verifier.reason || ""),
    quotes: { name: verifier.name_quote || "", municipality: verifier.municipality_quote || "",
      address: verifier.address_quote || "", phone: verifier.phone_quote || "" },
    model: row.verifier_model, prompt_version: row.prompt_version, decided_at: row.decided_at,
  };
}

function latestLlmOutcome(reviewDbPath, venueId) {
  if (!existsSync(reviewDbPath)) return null;
  const db = new DatabaseSync(reviewDbPath, { readOnly: true });
  try {
    const row = db.prepare(`${LLM_OUTCOME_SELECT}
      WHERE venue_id = ? ORDER BY decided_at DESC, outcome_id DESC LIMIT 1`).get(venueId);
    return row ? llmOutcomeRow(row) : null;
  } catch {
    return null; // a review database from another schema: show the card without it
  } finally {
    db.close();
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}
