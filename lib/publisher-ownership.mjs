const VERIFIED_METHODS = new Set([
  "manual_first_party_review",
  "official_registry",
  "verified_platform_claim",
  "verified_reciprocal_link",
]);

const COMPOUND_PUBLIC_SUFFIXES = new Set([
  "co.uk", "com.au", "com.br", "com.tr", "co.nz", "co.jp",
]);

export function publisherOwnershipFromReview(review, venueId = "") {
  if (review?.official_website_status !== "accepted") return [];
  const websiteUrl = cleanUrl(review.official_website_url);
  if (!websiteUrl) return [];
  const reviewedAt = validTimestamp(review.reviewed_at);
  const reviewer = clean(review.reviewer);
  const evidenceUrls = uniqueUrls(review.evidence_urls || []);
  if (!reviewedAt || !reviewer || evidenceUrls.length === 0) return [];
  return [{
    status: "verified",
    method: "manual_first_party_review",
    venue_id: clean(venueId) || undefined,
    website_url: websiteUrl,
    evidence_urls: evidenceUrls,
    reviewed_at: reviewedAt,
    reviewer,
    notes: clean(review.notes) || undefined,
  }];
}

export function evaluatePublisherOwnership(candidateUrl, restaurant = {}) {
  const candidateDomain = registrableDomain(candidateUrl);
  if (!candidateDomain) return unverified("invalid_candidate_domain");
  const attestations = Array.isArray(restaurant.publisher_ownership)
    ? restaurant.publisher_ownership : [];
  const malformed = [];
  for (const attestation of attestations) {
    const validation = validateAttestation(attestation, restaurant);
    if (!validation.valid) {
      malformed.push(validation.reason);
      continue;
    }
    if (registrableDomain(attestation.website_url) !== candidateDomain) continue;
    return {
      status: "verified",
      method: attestation.method,
      website_url: cleanUrl(attestation.website_url),
      evidence_urls: uniqueUrls(attestation.evidence_urls),
      reviewed_at: validTimestamp(attestation.reviewed_at),
      reviewer: clean(attestation.reviewer) || undefined,
      reason: "venue_scoped_attestation_matches_publisher",
    };
  }
  return unverified(malformed.length && malformed.length === attestations.length
    ? "invalid_ownership_attestation" : "no_matching_ownership_attestation");
}

export function registrableDomain(value) {
  let hostname;
  try { hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
  if (!hostname || hostname === "localhost" || /^\d+(?:\.\d+){3}$/.test(hostname)) return hostname;
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  return COMPOUND_PUBLIC_SUFFIXES.has(lastTwo)
    ? labels.slice(-3).join(".") : lastTwo;
}

function validateAttestation(value, restaurant) {
  if (!value || value.status !== "verified") return { valid: false, reason: "ownership_not_verified" };
  if (!VERIFIED_METHODS.has(value.method)) return { valid: false, reason: "unsupported_ownership_method" };
  if (!cleanUrl(value.website_url)) return { valid: false, reason: "invalid_attested_website" };
  if (!validTimestamp(value.reviewed_at)) return { valid: false, reason: "invalid_ownership_timestamp" };
  if (!Array.isArray(value.evidence_urls) || uniqueUrls(value.evidence_urls).length === 0) {
    return { valid: false, reason: "ownership_evidence_missing" };
  }
  if (value.method === "manual_first_party_review" && !clean(value.reviewer)) {
    return { valid: false, reason: "ownership_reviewer_missing" };
  }
  const expectedVenueId = clean(restaurant.canonical_venue_id);
  if (value.venue_id && expectedVenueId && clean(value.venue_id) !== expectedVenueId) {
    return { valid: false, reason: "ownership_venue_mismatch" };
  }
  return { valid: true };
}

function unverified(reason) {
  return { status: "unverified", method: null, reason };
}
function uniqueUrls(values) {
  return [...new Set(values.map(cleanUrl).filter(Boolean))];
}
function cleanUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}
function validTimestamp(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}
function clean(value) { return String(value || "").trim(); }
