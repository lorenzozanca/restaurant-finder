import { EvidenceStore } from "./evidence-store.mjs";
import { registrableDomain } from "./publisher-ownership.mjs";

const DAY_MS = 86_400_000;
const REVIEW_TTL_MS = 365 * DAY_MS;

// Validate one review-queue click and map it onto the durable attestation
// write. Pure: no database access, so the UI server and the tests share it.
// Never publishes facts; the store write below only touches attestations.
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
  if (registrableDomain(websiteUrl) !== candidateDomain) {
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
    venueId,
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

export function recordReviewDecision(dbPath, body, options = {}) {
  const { venueId, attestation, reason, recordedAt } = buildReviewDecision(body, options);
  const store = new EvidenceStore(dbPath, { clock: () => new Date(recordedAt) });
  try {
    const candidateDomain = registrableDomain(attestation.website_url);
    if (!store.nextReviewCandidate({
      venueId, candidateDomain, at: recordedAt,
    })) {
      throw new Error("review decision domain is not a stored candidate for this venue");
    }
    return store.recordPublisherAttestation(venueId, attestation, { reason, recordedAt });
  } finally {
    store.close();
  }
}
