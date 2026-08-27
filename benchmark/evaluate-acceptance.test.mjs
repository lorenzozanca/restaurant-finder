import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAcceptance, evaluateDurabilityGates } from "./evaluate-acceptance.mjs";

test("Phase 8 offline diagnostic is deterministic and cannot authorize rollout", async () => {
  const first = await evaluateAcceptance();
  const second = await evaluateAcceptance();
  assert.deepEqual(first, second);
  assert.equal(first.mode, "offline-diagnostic-replay");
  assert.equal(first.rollout_decision, "no_go");
  assert.equal(first.runs.length, 3);
  assert.ok(first.failed_gates.some((item) => item.id === "web_only_venue_recall"));
  assert.ok(first.failed_gates.some((item) => item.id === "search_attempt_audit"));
  assert.ok(first.failed_gates.some((item) => item.id === "live_acceptance_mode"));
});

test("durability gates require live isolated cold/warm evidence and manual review", () => {
  const passingRun = { cache_mode: "cold", publication_fingerprint: "same",
    gates: [{ passed: true }] };
  const gates = evaluateDurabilityGates({
    mode: "live-isolated",
    transient_outage: { passed: true, last_known_good_visible: true },
    manual_review: { new_acceptances_reviewed: true, lost_known_facts_reviewed: true },
    v1_fixture_integrity: { preserved: true, sha256: "abc" },
  }, [passingRun, { ...passingRun }, { ...passingRun, cache_mode: "warm", cache_hits: 3 }]);
  assert.ok(gates.every((item) => item.passed));

  const missingReview = evaluateDurabilityGates({ mode: "live-isolated" }, []);
  assert.equal(missingReview.find((item) => item.id === "manual_review_complete").passed, false);
  assert.equal(missingReview.find((item) => item.id === "two_cold_runs").passed, false);
});
