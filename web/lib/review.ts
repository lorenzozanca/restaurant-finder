import "server-only";
import { db } from "@/lib/db";

/**
 * Why a venue has its website status: the laptop's venueReview() answer from
 * venue_details, with the decisions made online shown as attestations until the
 * laptop has applied them.
 */
export async function venueReview(venueId: string) {
  const sql = db();
  const [row] = await sql`SELECT detail FROM venue_details WHERE venue_id = ${venueId}`;
  const detail = row?.detail ?? { venue_id: venueId, candidates: [], attestations: [], assessments: [], llm: null };
  const online = await sql`SELECT candidate_domain, decision, body, decided_by, created_at, applied_at, apply_error
    FROM manual_reviews WHERE venue_id = ${venueId} AND (applied_at IS NULL OR apply_error IS NOT NULL)
    ORDER BY id DESC LIMIT 5`;
  const pending = online.map((review) => ({
    domain: review.candidate_domain, status: review.decision === "approve" ? "verified" : "rejected",
    method: "manual_first_party_review", website: review.body.website_url, evidence_urls: review.body.evidence_urls,
    reviewer: review.body.reviewer, reviewed_at: new Date(review.created_at).toISOString(),
    notes: review.apply_error ? `not applied: ${review.apply_error}`
      : `waiting for the laptop sync${review.body.notes ? ` — ${review.body.notes}` : ""}`,
  }));
  return { ...detail, attestations: [...pending, ...detail.attestations] };
}
