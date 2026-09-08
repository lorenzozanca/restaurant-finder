import assert from "node:assert/strict";
import test from "node:test";
import { automaticPredictionForVenue, evaluateAutomaticFirstParty } from "./automatic-first-party-rule.mjs";

function assessment(overrides = {}) {
  return {
    candidate_url: "https://venue.test/", final_url: "https://venue.test/",
    assessment_state: "strongly_correlated", crawl_outcome: "succeeded",
    scores: { identity: 90, geography: 80, officialness: 85 },
    evidence: ["page_exact_name", "branded_domain", "page_municipality_match", "page_phone_match"],
    ...overrides,
  };
}

test("strict automatic rule requires name, geography, specific identity, and no contradiction", () => {
  assert.equal(evaluateAutomaticFirstParty(assessment()).eligible, true);
  assert.equal(evaluateAutomaticFirstParty(assessment({ evidence: ["page_exact_name", "branded_domain", "page_municipality_match"] }))
    .eligible, false);
  assert.equal(evaluateAutomaticFirstParty(assessment({
    evidence: ["page_exact_name", "branded_domain", "page_municipality_match", "page_phone_match", "cross_domain_canonical"],
  })).eligible, false);
  assert.equal(evaluateAutomaticFirstParty(assessment({ crawl_outcome: "failed" })).eligible, false);
});

test("venue prediction abstains when eligible candidates disagree on publisher", () => {
  assert.equal(automaticPredictionForVenue([assessment()]), "https://venue.test/");
  assert.equal(automaticPredictionForVenue([assessment(), assessment({
    candidate_url: "https://other.test/", final_url: "https://other.test/",
  })]), null);
});
