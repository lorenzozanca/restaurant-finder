import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => {
  if (!value.startsWith("--")) return null;
  return [value.slice(2), all[index + 1]];
}).filter(Boolean));
const manifestPath = args.manifest || "benchmark/SESSION-10-PILOT-SELECTION.json";
const databasePath = args.db || "data/session-10/session-10-pilot-live.sqlite";

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const db = new DatabaseSync(databasePath, { readOnly: true });
const candidates = manifest.candidates.filter((candidate) => candidate.review.venue_status === "valid");
const websites = db.prepare(`SELECT venue_id, fact_key FROM facts
  WHERE kind = 'website' AND decision_status = 'accepted'`).all();
const resources = db.prepare(`SELECT venue_id, fact_key, payload_json FROM facts
  WHERE kind = 'resource' AND decision_status = 'accepted'`).all()
  .map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));

const domain = (value) => {
  const labels = new URL(value).hostname.replace(/^www\./, "").split(".");
  return labels.slice(-2).join(".");
};
const interval = (successes, total) => {
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (p + z ** 2 / (2 * total)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / total + z ** 2 / (4 * total ** 2)) / denominator;
  return { numerator: successes, denominator: total, estimate: p,
    wilson_95: [center - half, center + half] };
};

const websiteByVenue = new Map(websites.map((fact) => [fact.venue_id, fact.fact_key]));
const websiteRows = candidates.map((candidate) => {
  const predicted = websiteByVenue.get(candidate.venue_id) || null;
  const expected = candidate.review.official_website_url;
  const correct = Boolean(predicted && expected && domain(predicted) === domain(expected));
  return { venue_id: candidate.venue_id, name: candidate.name, expected, predicted, correct };
});
const truePositives = websiteRows.filter((row) => row.correct).length;
const falsePositives = websiteRows.filter((row) => row.predicted && !row.correct);
const expectedWebsites = websiteRows.filter((row) => row.expected).length;

const goldResources = candidates.flatMap((candidate) => candidate.review.resources
  .filter((resource) => resource.status === "accepted")
  .map((resource) => ({ venue_id: candidate.venue_id, name: candidate.name, ...resource })));
const matchedGold = new Set();
const resourceRows = resources.map((fact) => {
  const matchIndex = goldResources.findIndex((gold, index) => !matchedGold.has(index)
    && gold.venue_id === fact.venue_id && gold.role === fact.payload.role
    && domain(gold.url) === domain(fact.fact_key));
  if (matchIndex >= 0) matchedGold.add(matchIndex);
  return { venue_id: fact.venue_id, url: fact.fact_key, role: fact.payload.role,
    strict_benchmark_match: matchIndex >= 0 };
});

const output = {
  inputs: { manifest: manifestPath, database: databasePath },
  reviewed_valid_venues: candidates.length,
  venue_admission_precision: interval(candidates.length, candidates.length),
  websites: {
    published: websites.length,
    expected: expectedWebsites,
    precision: interval(truePositives, websites.length),
    recall: interval(truePositives, expectedWebsites),
    false_positives: falsePositives,
    false_negatives: websiteRows.filter((row) => row.expected && !row.correct),
  },
  resources: {
    published: resources.length,
    labelled_expected: goldResources.length,
    strict_precision: interval(matchedGold.size, resources.length),
    strict_recall: interval(matchedGold.size, goldResources.length),
    note: "Strict URL-domain and exact-role comparison; novel outputs still require independent adjudication.",
    outputs: resourceRows,
  },
};
console.log(JSON.stringify(output, null, 2));
