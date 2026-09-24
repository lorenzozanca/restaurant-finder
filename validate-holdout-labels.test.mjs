import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { labellingPackets } from "./prepare-holdout-labelling.mjs";
import { validateHoldoutLabels } from "./validate-holdout-labels.mjs";

const instructions = readFileSync(new URL("./benchmark/llm-review-holdout-v1/LABELLING-INSTRUCTIONS.md",
  import.meta.url), "utf8");

function exampleDocument() {
  const block = instructions.split("## Example")[1].match(/```json\n([\s\S]*?)```/)[1];
  return JSON.parse(block);
}

function fakeHoldout(document) {
  const entry = document.entries[0];
  const url = entry.domain_reviews[0].evidence_urls[0];
  const fixture = { schema_version: 1, fixture_set: "source-candidate-locked_holdout",
    source: "source_candidate", brave_requests_made: 0,
    selection_fingerprint_sha256: document.selection_fingerprint_sha256, bounded_result_limit: 1,
    entries: [{ venue_id: entry.venue_id, name: "Trattoria Esempio", municipality: "esempio", region: "05",
      address: "Via Roma 1", partition: "locked_holdout", query: "source_candidate",
      retrieved_at: "2026-09-24T00:00:00.000Z", candidates: [{ title: "Trattoria Esempio", url }],
      adjudication: null }] };
  const identities = new Map([[entry.venue_id, { name: "Trattoria Esempio", aliases: [],
    address: "Via Roma 1, 31046 Esempio", postcode: "31046", municipality: "Esempio", region: "05",
    phone: "+390422000000" }]]);
  return { fixture, packets: labellingPackets(fixture, identities, { batchSize: 48 }) };
}

test("the instruction example is a valid complete label set for its packet", () => {
  const document = exampleDocument();
  const { fixture, packets } = fakeHoldout(document);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].output_file, "locked-holdout-adjudication-001-001.json");
  for (const [key, value] of Object.entries(packets[0].adjudication_header)) {
    assert.equal(document[key], value, `the example copies the packet header's ${key}`);
  }
  assert.equal(packets[0].venues[0].candidate_registrable_domain, "trattoriaesempio.example");
  assert.equal(packets[0].venues[0].phone, "+390422000000");
  const result = validateHoldoutLabels([{ file: packets[0].output_file, document }], fixture, packets,
    { complete: true });
  assert.equal(result.venues, 1);
  assert.equal(result.ownership_statuses.verified, 1);
});

test("label batches need a rationale, their packet's venues, and a non-reviewer labeller", () => {
  const { fixture, packets } = fakeHoldout(exampleDocument());
  const check = (mutate, file = packets[0].output_file) => {
    const document = exampleDocument();
    mutate(document);
    return () => validateHoldoutLabels([{ file, document }], fixture, packets);
  };
  assert.throws(check((document) => { delete document.entries[0].domain_reviews[0].rationale; }),
    /lacks a rationale/);
  assert.throws(check(() => {}, "locked-holdout-adjudication-002-002.json"), /no labelling packet/);
  assert.throws(check((document) => { document.reviewer = "xiaomi/mimo-v2.6-pro"; }), /cannot label/);
  assert.throws(check((document) => { document.entries[0].evidence_urls = ["https://elsewhere.example/"]; }),
    /outside its bounded fixture/);
  assert.throws(() => validateHoldoutLabels([], fixture, packets, { complete: true }), /incomplete/);
});
