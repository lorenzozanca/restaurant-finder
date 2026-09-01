#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { EnrichmentQueue } from "./lib/enrichment-queue.mjs";

const VENUE = new Set(["valid", "not_a_venue", "closed", "uncertain"]);
const MUNICIPALITY = new Set(["correct", "incorrect", "uncertain"]);
const WEBSITE = new Set(["accepted", "rejected", "no_official_site", "uncertain"]);
const RESOURCE = new Set(["accepted", "rejected", "uncertain"]);
const ROLES = new Set(["menu", "order", "booking"]);

export function validatePilotReviews(manifest) {
  if (!Array.isArray(manifest?.candidates) || manifest.candidates.length === 0) {
    throw new Error("pilot manifest must contain candidates");
  }
  const seen = new Set();
  for (const candidate of manifest.candidates) {
    const label = `candidate ${candidate.selection_index ?? candidate.venue_id ?? "unknown"}`;
    if (!candidate.venue_id || seen.has(candidate.venue_id)) throw new Error(`${label}: missing or duplicate venue_id`);
    seen.add(candidate.venue_id);
    const review = candidate.review;
    if (!review || !String(review.reviewer || "").trim()) throw new Error(`${label}: reviewer is required`);
    if (!Number.isFinite(Date.parse(review.reviewed_at))) throw new Error(`${label}: reviewed_at must be ISO-compatible`);
    if (!VENUE.has(review.venue_status)) throw new Error(`${label}: invalid venue_status`);
    if (!MUNICIPALITY.has(review.municipality_assignment)) throw new Error(`${label}: invalid municipality_assignment`);
    if (!WEBSITE.has(review.official_website_status)) throw new Error(`${label}: invalid official_website_status`);
    if (review.official_website_status === "accepted" && !isHttpUrl(review.official_website_url)) {
      throw new Error(`${label}: accepted official website requires an HTTP(S) URL`);
    }
    if (!Array.isArray(review.evidence_urls) || review.evidence_urls.length === 0
      || review.evidence_urls.some((url) => !isHttpUrl(url))) {
      throw new Error(`${label}: at least one valid evidence URL is required`);
    }
    if (!Array.isArray(review.resources)) throw new Error(`${label}: resources must be an array`);
    for (const resource of review.resources) {
      if (!isHttpUrl(resource?.url) || !RESOURCE.has(resource?.status) || !ROLES.has(resource?.role)) {
        throw new Error(`${label}: invalid reviewed resource`);
      }
    }
    if (!String(review.notes || "").trim()) throw new Error(`${label}: notes are required`);
  }
  return {
    reviewed: manifest.candidates.length,
    approved: manifest.candidates.filter(isApproved).length,
    uncertain: manifest.candidates.filter((row) => row.review.venue_status === "uncertain").length,
  };
}

export function preparePilotDatabase({ sourcePath, targetPath, manifest, maxAttempts = 2 }) {
  const validation = validatePilotReviews(manifest);
  if (existsSync(targetPath)) throw new Error(`refusing to overwrite existing pilot database: ${targetPath}`);
  if (!existsSync(sourcePath)) throw new Error(`source database not found: ${sourcePath}`);
  const approved = manifest.candidates.filter(isApproved);
  if (approved.length === 0) throw new Error("manual review approved no pilot candidates");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const queue = new EnrichmentQueue(targetPath);
  try {
    for (const candidate of approved) {
      const venue = source.prepare("SELECT * FROM venues WHERE venue_id = ?").get(candidate.venue_id);
      const job = source.prepare("SELECT * FROM enrichment_jobs WHERE venue_id = ? ORDER BY job_id LIMIT 1")
        .get(candidate.venue_id);
      const sourceRows = source.prepare("SELECT * FROM source_records WHERE venue_id = ? ORDER BY source_record_id")
        .all(candidate.venue_id);
      if (!venue || !job || sourceRows.length === 0) throw new Error(`source data incomplete for ${candidate.venue_id}`);
      if (job.status !== "queued" || job.attempt_count !== 0) {
        throw new Error(`source job is not untouched for ${candidate.venue_id}`);
      }
      const records = sourceRows.map((row) => JSON.parse(row.payload_json));
      const primary = records[0];
      queue.enqueue({
        venue: {
          ...primary,
          canonical_venue_id: candidate.venue_id,
          name: venue.display_name,
          aliases: [...new Set(records.flatMap((row) => row.aliases || []))],
          source_records: records,
        },
        municipality: candidate.municipality,
        idempotencyKey: job.idempotency_key,
        stage: job.stage,
        priority: job.priority,
        provider: job.provider,
        domain: job.domain,
        maxAttempts,
        payload: JSON.parse(job.payload_json),
        createdAt: job.created_at,
      });
    }
    const status = queue.status();
    if (status.counts.queued !== approved.length || status.active !== approved.length) {
      throw new Error(`pilot queue integrity failure: expected ${approved.length} queued jobs`);
    }
    return { ...validation, target: targetPath, queue: status };
  } finally {
    queue.close();
    source.close();
  }
}

function isApproved(candidate) {
  return candidate.review.venue_status === "valid"
    && candidate.review.municipality_assignment === "correct"
    && candidate.review.duplicate_of_venue_id === null;
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`invalid argument ${key || ""}`);
    args[key.slice(2)] = argv[index + 1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.manifest || !args.output) {
    throw new Error("usage: node prepare-pilot.mjs --source SOURCE.sqlite --manifest SELECTION.json --output PILOT.sqlite");
  }
  const manifest = JSON.parse(readFileSync(resolve(args.manifest), "utf8"));
  const result = preparePilotDatabase({
    sourcePath: resolve(args.source), targetPath: resolve(args.output), manifest,
    maxAttempts: Number(args["max-attempts"] || 2),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
