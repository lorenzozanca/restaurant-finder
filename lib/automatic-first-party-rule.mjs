import { classifyWebsite } from "../find-menu.mjs";

export const AUTOMATIC_FIRST_PARTY_RULE_VERSION = "strict-first-party-v1";

const CONTRADICTIONS = new Set([
  "cross_domain_canonical", "geography_contradiction", "non_restaurant_context",
  "structured_editorial_data", "non_official_domain", "redirect_domain_changed",
]);

export function evaluateAutomaticFirstParty(assessment) {
  const evidence = new Set(Array.isArray(assessment?.evidence) ? assessment.evidence : []);
  const failures = [];
  if (assessment?.assessment_state !== "strongly_correlated") failures.push("not_strongly_correlated");
  if (assessment?.crawl_outcome !== "succeeded") failures.push("crawl_not_succeeded");
  if (classifyWebsite(assessment?.candidate_url) !== "official"
      || classifyWebsite(assessment?.final_url) !== "official") failures.push("unsupported_publisher");
  if (!["page_exact_name", "page_name_tokens"].some((reason) => evidence.has(reason))) {
    failures.push("venue_name_not_compatible");
  }
  if (!evidence.has("branded_domain")) failures.push("publisher_domain_not_venue_branded");
  if (!evidence.has("page_municipality_match")) failures.push("municipality_not_compatible");
  if (!evidence.has("page_phone_match") && !evidence.has("page_address_match")) {
    failures.push("high_specificity_identity_missing");
  }
  if ([...CONTRADICTIONS].some((reason) => evidence.has(reason))) failures.push("contradiction_present");
  return {
    eligible: failures.length === 0,
    rule_version: AUTOMATIC_FIRST_PARTY_RULE_VERSION,
    failures: [...new Set(failures)],
  };
}

export function automaticPredictionForVenue(assessments) {
  const eligible = (assessments || []).filter((assessment) =>
    evaluateAutomaticFirstParty(assessment).eligible);
  const domains = new Set(eligible.map((assessment) => domain(assessment.final_url)).filter(Boolean));
  if (domains.size !== 1) return null;
  return eligible.toSorted((left, right) => totalScore(right) - totalScore(left)
    || String(left.final_url).localeCompare(String(right.final_url)))[0]?.final_url || null;
}

function totalScore(value) {
  return Number(value?.scores?.identity || 0) + Number(value?.scores?.geography || 0)
    + Number(value?.scores?.officialness || 0);
}
function domain(value) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; } }
