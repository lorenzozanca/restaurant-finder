#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  evaluatePublisherOwnership,
  publisherOwnershipFromReview,
  registrableDomain,
} from "../lib/publisher-ownership.mjs";

export function replayPublisherOwnership({ dbPath, selectionPath, pilot }) {
  const selection = JSON.parse(readFileSync(resolve(selectionPath), "utf8"));
  const reviewed = new Map((selection.candidates || []).map((row) => [row.venue_id, row]));
  const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
  let rows;
  try {
    rows = db.prepare(`SELECT v.venue_id, v.display_name, f.payload_json
      FROM facts f JOIN venues v USING (venue_id)
      WHERE f.kind = ? AND f.decision_status = ? ORDER BY v.venue_id`).all("website", "accepted");
  } finally {
    db.close();
  }
  const cases = rows.map((row) => evaluatePublication(row, reviewed.get(row.venue_id)));
  const trueCases = cases.filter((item) => item.label === "official");
  const falseCases = cases.filter((item) => item.label === "not_official");
  return {
    pilot,
    publications: cases.length,
    true_publications: trueCases.length,
    false_publications: falseCases.length,
    true_retained: trueCases.filter((item) => item.policy_action === "retain").length,
    false_rejected: falseCases.filter((item) => item.policy_action === "reject").length,
    passed: cases.every((item) => item.passed),
    cases,
  };
}

export function evaluatePublication(row, reviewedRow) {
  const payload = JSON.parse(row.payload_json);
  const publishedUrl = payload.website_provenance?.source_url
    || payload.website_decision?.final_url || "";
  const expectedUrl = reviewedRow?.review?.official_website_status === "accepted"
    ? reviewedRow.review.official_website_url : "";
  const label = expectedUrl && registrableDomain(expectedUrl) === registrableDomain(publishedUrl)
    ? "official" : "not_official";
  const ownership = evaluatePublisherOwnership(publishedUrl, {
    canonical_venue_id: row.venue_id,
    publisher_ownership: publisherOwnershipFromReview(reviewedRow?.review, row.venue_id),
  });
  const policyAction = ownership.status === "verified" ? "retain" : "reject";
  return {
    venue_id: row.venue_id,
    name: row.display_name,
    published_url: publishedUrl,
    adjudicated_url: expectedUrl || null,
    label,
    policy_action: policyAction,
    ownership_status: ownership.status,
    ownership_reason: ownership.reason,
    passed: label === "official" ? policyAction === "retain" : policyAction === "reject",
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument ${argv[index] || ""}`);
    }
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.selection || !args.pilot) {
    throw new Error("usage: node benchmark/replay-publisher-ownership.mjs --db PILOT.sqlite --selection SELECTION.json --pilot NAME");
  }
  const result = replayPublisherOwnership({
    dbPath: args.db, selectionPath: args.selection, pilot: args.pilot,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
