import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  ASSESSMENT_SELECT, ATTESTATION_SELECT, LLM_OUTCOME_SELECT, assessmentRow, attestationRow, candidateList,
  llmOutcomeRow,
} from "./review-queue.mjs";

// What the venue card's "Why this status" shows, for every venue at once, so the
// online app (web/) can answer without the SQLite store. Each detail has the same
// shape as venueReview() in lib/review-queue.mjs; only the newest few crawl
// assessments are kept, which is all the card shows.

const ASSESSMENTS_KEPT = 3;

// snapshot: the map snapshot (lib/map-snapshot.mjs) built from the same store; its
// candidate_url column is the source website each venue review starts from.
export function buildVenueDetails(dbPath, snapshot, options = {}) {
  const at = String(options.at || new Date().toISOString());
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const byVenue = new Map();
  const entry = (venueId) => {
    let detail = byVenue.get(venueId);
    if (!detail) {
      detail = { venue_id: venueId, sources: [], facts: [], attestations: [], assessments: [], llm: null };
      byVenue.set(venueId, detail);
    }
    return detail;
  };
  const { id, candidate_url: candidateUrl } = snapshot.columns;
  const known = new Set(id);
  try {
    for (let i = 0; i < id.length; i++) {
      if (candidateUrl[i]) entry(id[i]).sources.push({ url: candidateUrl[i], source: "record" });
    }
    for (const row of db.prepare(`SELECT venue_id, fact_key, decision_status FROM facts
        WHERE kind = 'website' AND lifecycle_status = 'active' ORDER BY fact_id`).iterate()) {
      if (known.has(row.venue_id)) entry(row.venue_id).facts.push(row);
    }
    for (const row of db.prepare(`${ATTESTATION_SELECT} WHERE lifecycle_status = 'active'
        AND reviewed_at <= ? AND expires_at > ? ORDER BY reviewed_at DESC`).iterate(at, at)) {
      if (known.has(row.venue_id)) entry(row.venue_id).attestations.push(attestationRow(row));
    }
    for (const row of db.prepare(`${ASSESSMENT_SELECT} ORDER BY checked_at DESC`).iterate()) {
      if (!known.has(row.venue_id)) continue;
      const detail = entry(row.venue_id);
      if (detail.assessments.length < ASSESSMENTS_KEPT) detail.assessments.push(assessmentRow(row));
    }
  } finally {
    db.close();
  }
  if (options.reviewDbPath && existsSync(options.reviewDbPath)) {
    const review = new DatabaseSync(options.reviewDbPath, { readOnly: true });
    try {
      for (const row of review.prepare(`${LLM_OUTCOME_SELECT}
          ORDER BY decided_at DESC, outcome_id DESC`).iterate()) {
        const detail = byVenue.get(row.venue_id);
        if (detail && !detail.llm) detail.llm = llmOutcomeRow(row);
      }
    } catch {
      // a review database from another schema: the cards show no LLM reason
    } finally {
      review.close();
    }
  }
  const details = new Map();
  for (const [venueId, detail] of byVenue) {
    const value = { venue_id: venueId, candidates: candidateList(detail.sources, detail.facts),
      attestations: detail.attestations, assessments: detail.assessments, llm: detail.llm };
    details.set(venueId, { detail: value, hash: detailHash(value) });
  }
  return details;
}

export function detailHash(detail) {
  return createHash("sha256").update(JSON.stringify(detail)).digest("hex").slice(0, 32);
}
