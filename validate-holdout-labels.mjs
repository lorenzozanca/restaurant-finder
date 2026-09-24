#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateWebAdjudicationDocument, validateWebAdjudicationSet } from "./lib/web-stress-fixture.mjs";

// Checks the operator-run agent's labels for the LLM-review holdout (PROCESS.md step
// 3.3) against the fixture and labelling packets, and seals a complete set before the
// frozen reviewer may run. Every label batch must cover exactly its packet's venues and
// give a rationale for each domain verdict.

export function validateHoldoutLabels(adjudications, fixture, packets, options = {}) {
  const packetsByOutput = new Map(packets.map((packet) => [packet.output_file, packet]));
  const totals = { batches: 0, venues: 0 };
  for (const { file, document } of adjudications) {
    const packet = packetsByOutput.get(file);
    if (!packet) throw new Error(`${file}: no labelling packet names this output file`);
    validateWebAdjudicationDocument(document, fixture, { expectedPartition: "locked_holdout" });
    if (/mimo|xiaomi/i.test(String(document.reviewer))) {
      throw new Error(`${file}: the reviewer model cannot label its own holdout`);
    }
    const expected = new Set(packet.venues.map((venue) => venue.venue_id));
    const actual = new Set(document.entries.map((entry) => entry.venue_id));
    if (expected.size !== actual.size || [...expected].some((venueId) => !actual.has(venueId))) {
      throw new Error(`${file}: entries do not match packet ${packet.packet}`);
    }
    for (const entry of document.entries) {
      for (const review of entry.domain_reviews) {
        if (typeof review.rationale !== "string" || !review.rationale.trim()) {
          throw new Error(`${file}: ${entry.venue_id} ${review.registrable_domain} lacks a rationale`);
        }
      }
    }
    totals.batches++;
    totals.venues += document.entries.length;
  }
  if (options.complete) {
    if (totals.batches !== packets.length) {
      throw new Error(`label set is incomplete: ${totals.batches} of ${packets.length} batches`);
    }
    return { ...totals, ...validateWebAdjudicationSet(adjudications.map((item) => item.document), fixture,
      { expectedPartition: "locked_holdout" }) };
  }
  return totals;
}

export function loadHoldoutDirectory(directory, onlyFile = null) {
  const names = readdirSync(directory).sort();
  const fixtureNames = names.filter((name) => /^locked-holdout-\d{3}-\d{3}\.json$/.test(name));
  if (fixtureNames.length !== 1) throw new Error("expected exactly one locked-holdout fixture");
  const labelling = join(directory, "labelling");
  const packets = readdirSync(labelling).sort().filter((name) => /^packet-\d{3}-\d{3}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(labelling, name), "utf8")));
  const adjudications = names.filter((name) => /^locked-holdout-adjudication-\d{3}-\d{3}\.json$/.test(name))
    .filter((name) => !onlyFile || name === onlyFile).map((file) => {
      const bytes = readFileSync(join(directory, file));
      return { file, sha256: sha256(bytes), document: JSON.parse(bytes) };
    });
  const fixtureBytes = readFileSync(join(directory, fixtureNames[0]));
  return { fixtureFile: fixtureNames[0], fixtureSha256: sha256(fixtureBytes),
    fixture: JSON.parse(fixtureBytes), packets, adjudications };
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const directory = resolve(argv.includes("--holdout-dir") ? argv[argv.indexOf("--holdout-dir") + 1]
    : "benchmark/llm-review-holdout-v1");
  const seal = argv.includes("--seal");
  const only = argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : null;
  const loaded = loadHoldoutDirectory(directory, only);
  if (only && seal) throw new Error("--seal checks the whole set; do not combine it with --file");
  if (only && !loaded.adjudications.length) throw new Error(`${only}: label file not found`);
  const result = validateHoldoutLabels(loaded.adjudications, loaded.fixture, loaded.packets,
    { complete: seal || argv.includes("--complete") });
  if (seal) {
    const sealPath = join(directory, "LABELS-SEAL.json");
    if (existsSync(sealPath)) throw new Error("labels are already sealed; a seal is never rewritten");
    writeFileSync(sealPath, `${JSON.stringify({
      sealed_at: new Date().toISOString(), fixture: loaded.fixtureFile, fixture_sha256: loaded.fixtureSha256,
      selection_fingerprint_sha256: loaded.fixture.selection_fingerprint_sha256,
      reviewers: [...new Set(loaded.adjudications.map((item) => item.document.reviewer))],
      adjudications: loaded.adjudications.map(({ file, sha256: digest }) => ({ file, sha256: digest })),
      totals: result,
    }, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ ...result, packets: loaded.packets.length, sealed: seal }, null, 2)}\n`);
}
