import { EvidenceStore } from "./evidence-store.mjs";

// A national store with one venue for each lead status, shared by the lead-map tests.

const at = "2026-09-20T00:00:00.000Z";

export function leadFixtureStore(path) {
  const store = new EvidenceStore(path);
  const venue = (id, name, type, region, province, municipality, latitude, longitude, website, phone = "+39041000000") =>
    store.rememberVenue({ canonical_venue_id: id, name, source_records: [{ source_record_id: `${id}:source`,
      source: "overture_places", name, municipality, province_code: province, region_code: region, type,
      address: `Via ${name} 1`, phone, latitude, longitude, ...(website ? { website } : {}) }] },
    { checkedAt: at, municipality });
  const assess = (id, url, state, evidence = []) => store.recordCandidateAssessment(id, { candidate_url: url,
    final_url: url, assessment_state: state, crawl_outcome: state === "retryable" ? "failed" : "succeeded",
    scores: { identity: 50, geography: 50, officialness: 50 }, evidence, candidate_origin: "source_candidate" },
  { checkedAt: at });
  venue("venue:ok", "Da Mario", "pizzeria", "05", "VE", "Venezia", 45.44, 12.33, "https://mario.example/");
  venue("venue:no", "Bar \"Sole\", Centro", "bar", "05", "VE", "Venezia", 45.441, 12.331, "https://no.example/");
  venue("venue:dir", "Caffè Dir", "cafe", "05", "TV", "Treviso", 45.66, 12.24, "https://facebook.com/dir");
  venue("venue:amb", "Trattoria Amb", "restaurant", "12", "RM", "Roma", 41.9, 12.5, "https://amb.example/");
  venue("venue:dead", "Pub Dead", "pub", "12", "RM", "Roma", 41.901, 12.501, "https://dead.example/");
  venue("venue:new", "Gelato Nuovo", "ice cream", "12", "RM", "Roma", 41.902, 12.502, "https://new.example/", "");
  venue("venue:none", "Fast None", "fast food", "12", "RM", "Roma", 41.903, 12.503, "");
  store.recordEnrichment({ canonical_venue_id: "venue:ok", name: "Da Mario" }, { website: "https://mario.example/",
    website_decision: { status: "accepted", scores: {}, confidence: "high", evidence: [] },
    resources: [], resource_decisions: [], enrichment_run: {} }, { checkedAt: at, municipality: "Venezia" });
  store.recordPublisherAttestation("venue:ok", { status: "verified", method: "manual_first_party_review",
    venue_id: "venue:ok", website_url: "https://mario.example/", evidence_urls: ["https://mario.example/"],
    reviewed_at: at, expires_at: "2027-09-20T00:00:00.000Z", reviewer: "test", source_kind: "human_review" },
  { recordedAt: at });
  store.recordPublisherAttestation("venue:no", { status: "rejected", method: "manual_first_party_review",
    venue_id: "venue:no", website_url: "https://no.example/", evidence_urls: ["https://no.example/"],
    reviewed_at: at, expires_at: "2027-09-20T00:00:00.000Z", reviewer: "test", source_kind: "human_review" },
  { recordedAt: at });
  assess("venue:ok", "https://mario.example/", "strongly_correlated");
  assess("venue:dir", "https://facebook.com/dir", "unsupported_publisher");
  assess("venue:amb", "https://amb.example/", "ambiguous");
  assess("venue:dead", "https://dead.example/", "retryable",
    ["candidate_temporarily_unreachable", "transport_failure", "failure_ENOTFOUND"]);
  store.close();
}
