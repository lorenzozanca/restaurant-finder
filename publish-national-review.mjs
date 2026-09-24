#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { EvidenceStore } from "./lib/evidence-store.mjs";

// Copies national review batches (PROCESS.md step 4) into the national store the map
// reads: every crawl assessment, and each certified-reviewer outcome as an ownership
// attestation (accepted -> verified website, rejected -> rejected candidate). Only
// outcomes from the frozen reviewer settings are published. Idempotent.

export function publishNationalReview(reviewDbPath, nationalStore, freeze, options = {}) {
  const review = new DatabaseSync(reviewDbPath, { readOnly: true });
  const reviewer = `${freeze.reviewer.verifier_model} ${freeze.reviewer.prompt_version}`;
  const counts = { assessments: 0, verified: 0, rejected: 0, skipped_manual: 0, skipped_unfrozen: 0 };
  try {
    const assessments = review.prepare("SELECT * FROM candidate_assessments ORDER BY assessment_id").all();
    const outcomes = review.prepare(`SELECT * FROM llm_review_outcomes WHERE run_id LIKE ?
      AND outcome IN ('accepted', 'rejected') ORDER BY outcome_id`).all(`${options.runPrefix || "national-"}%`);
    const manual = new Set(nationalStore.db.prepare(`SELECT venue_id FROM publisher_attestations
      WHERE decision_status = 'verified' AND lifecycle_status = 'active'
        AND method <> 'automated_llm_ownership_review'`).all().map((row) => row.venue_id));
    nationalStore.transaction(() => {
      for (const row of assessments) {
        nationalStore.recordCandidateAssessment(row.venue_id, { candidate_url: row.candidate_url,
          final_url: row.final_url, assessment_state: row.assessment_state, crawl_outcome: row.crawl_outcome,
          scores: { identity: row.identity_score, geography: row.geography_score,
            officialness: row.officialness_score },
          evidence: JSON.parse(row.evidence_json || "[]"), candidate_origin: "source_candidate" },
        { checkedAt: row.checked_at });
        counts.assessments++;
      }
      for (const row of outcomes) {
        if (row.verifier_model !== freeze.reviewer.verifier_model
            || row.prompt_version !== freeze.reviewer.prompt_version) { counts.skipped_unfrozen++; continue; }
        if (manual.has(row.venue_id)) { counts.skipped_manual++; continue; }
        const common = { reviewed_at: row.decided_at, reviewer, source_fingerprint: row.input_sha256 };
        if (row.outcome === "accepted") {
          nationalStore.publishLlmVerifiedWebsite(row.venue_id, { ...common, website_url: row.final_url,
            candidate_url: row.candidate_url, run_id: row.run_id });
          counts.verified++;
        } else {
          nationalStore.recordPublisherAttestation(row.venue_id, { ...common, status: "rejected",
            method: "automated_llm_ownership_review", venue_id: row.venue_id, website_url: row.candidate_url,
            evidence_urls: [row.final_url], expires_at: new Date(Date.parse(row.decided_at) + 365 * 86_400_000)
              .toISOString(), source_kind: "certified_llm_review" });
          counts.rejected++;
        }
      }
    });
    return counts;
  } finally { review.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const nationalPath = resolve(arg("--db", "data/istat/2026-01-01/derived/italy-import.sqlite"));
  const backup = nationalPath.replace(/\.sqlite$/, ".pre-llm-publish.sqlite");
  if (!existsSync(backup)) copyFileSync(nationalPath, backup);
  const freeze = JSON.parse(readFileSync(resolve("benchmark/llm-review-holdout-v1/REVIEWER-FREEZE.json"), "utf8"));
  const store = new EvidenceStore(nationalPath);
  try {
    const counts = publishNationalReview(resolve(arg("--review-db", "data/national-review/review.sqlite")), store, freeze);
    console.log(JSON.stringify({ ...counts, backup, national_assessments: store.candidateAssessmentCounts() }));
  } finally { store.close(); }
}
