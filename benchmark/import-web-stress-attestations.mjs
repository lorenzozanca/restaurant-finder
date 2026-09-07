#!/usr/bin/env node
// Import verified publisher-domain ownership from independent web-stress
// adjudication documents (Session 11/12 development and locked-holdout
// reviews) as durable publisher attestations.
//
// Only `accepted` official websites whose registrable domain carries a
// `verified` ownership decision are imported. Uncertain, rejected, and
// `no_official_site` outcomes are skipped: absence of an attestation
// already fails closed at publication time. Frozen selection, capture,
// and evaluation artifacts are only read, never modified.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EvidenceStore } from "../lib/evidence-store.mjs";
import { registrableDomain } from "../lib/publisher-ownership.mjs";

const DAY = 86_400_000;

export function collectVerifiedAttestations(document, options = {}) {
  if (!document || document.schema_version !== 1 || !Array.isArray(document.entries)) {
    throw new Error("invalid web adjudication document");
  }
  if (document.source !== "independent_fixture_review") {
    throw new Error("web adjudication is not an independent fixture review");
  }
  const fingerprint = String(document.selection_fingerprint_sha256 || "").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("web adjudication selection fingerprint is missing");
  }
  const reviewer = String(document.reviewer || "").trim();
  if (!reviewer) throw new Error("web adjudication reviewer is missing");
  const collected = [];
  for (const entry of document.entries) {
    if (!entry?.venue_id) throw new Error("web adjudication entry is missing its venue ID");
    if (entry.official_website_status !== "accepted") continue;
    const websiteUrl = String(entry.official_website_url || "").trim();
    const domain = registrableDomain(websiteUrl);
    if (!domain) throw new Error(`accepted website is not a valid URL: ${entry.venue_id}`);
    const verified = (entry.domain_reviews || [])
      .filter((item) => item?.ownership_status === "verified");
    const match = verified.find((item) => item.registrable_domain === domain);
    if (!match) {
      throw new Error(`accepted website lacks verified domain ownership: ${entry.venue_id}`);
    }
    if (typeof match.ownership_method !== "string" || !match.ownership_method) {
      throw new Error(`verified ownership lacks a method: ${entry.venue_id}`);
    }
    if (!Array.isArray(match.ownership_evidence_urls)
        || match.ownership_evidence_urls.length === 0) {
      throw new Error(`verified ownership lacks evidence URLs: ${entry.venue_id}`);
    }
    const reviewedAt = new Date(match.ownership_reviewed_at || document.reviewed_at);
    if (!Number.isFinite(reviewedAt.getTime())) {
      throw new Error(`verified ownership lacks a review time: ${entry.venue_id}`);
    }
    // The evidence store requires one valid URL per entry; reviews sometimes
    // list the same first-party URL twice. Dedupe deterministically.
    const evidenceUrls = [...new Set(match.ownership_evidence_urls)];
    collected.push({
      venue_id: entry.venue_id,
      website_url: websiteUrl,
      method: match.ownership_method,
      evidence_urls: evidenceUrls,
      reviewer,
      reviewed_at: reviewedAt.toISOString(),
      expires_at: options.expiresAt
        || new Date(reviewedAt.getTime() + (options.ttl ?? 365 * DAY)).toISOString(),
      notes: `independent ${document.partition || "web"} review; publisher class ${match.publisher_class || "official"}`,
      source_kind: "human_review",
      source_fingerprint: fingerprint,
    });
  }
  return collected;
}

export function importWebStressAttestations(store, documents, options = {}) {
  const docs = Array.isArray(documents) ? documents : [documents];
  const seenVenues = new Set();
  let imported = 0;
  let unchanged = 0;
  let skippedDuplicates = 0;
  const venues = [];
  for (const document of docs) {
    for (const attestation of collectVerifiedAttestations(document, options)) {
      if (seenVenues.has(attestation.venue_id)) {
        skippedDuplicates++;
        continue;
      }
      seenVenues.add(attestation.venue_id);
      const domain = registrableDomain(attestation.website_url);
      const before = store.db.prepare(`SELECT updated_at FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(attestation.venue_id, domain);
      store.recordPublisherAttestation(attestation.venue_id, {
        status: "verified",
        method: attestation.method,
        venue_id: attestation.venue_id,
        website_url: attestation.website_url,
        evidence_urls: attestation.evidence_urls,
        reviewed_at: attestation.reviewed_at,
        expires_at: attestation.expires_at,
        reviewer: attestation.reviewer,
        notes: attestation.notes,
        source_kind: attestation.source_kind,
        source_fingerprint: attestation.source_fingerprint,
      }, { reason: options.reason || "import:independent-web-review" });
      const after = store.db.prepare(`SELECT updated_at FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(attestation.venue_id, domain);
      if (before?.updated_at === after?.updated_at) unchanged++;
      else imported++;
      venues.push({ venue_id: attestation.venue_id, website_url: attestation.website_url });
    }
  }
  return { imported, unchanged, skipped_duplicates: skippedDuplicates,
    accepted: imported + unchanged, venues };
}

function parseArgs(argv) {
  const args = { adjudication: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`invalid argument ${item}`);
    const [rawKey, inline] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Error(`missing value for ${item}`);
    if (key === "adjudication") args.adjudication.push(value);
    else args[key] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.adjudication.length) {
    throw new Error("usage: node import-web-stress-attestations.mjs --db PATH --adjudication PATH [--adjudication PATH...] [--expires-at ISO] [--ttl-days N]");
  }
  const store = new EvidenceStore(resolve(String(args.db)));
  try {
    const documents = args.adjudication.map((item) => JSON.parse(readFileSync(resolve(String(item)), "utf8")));
    const options = { reason: "import:independent-web-review" };
    if (args.expiresAt) options.expiresAt = new Date(String(args.expiresAt)).toISOString();
    if (args.ttlDays !== undefined) {
      const days = Number(args.ttlDays);
      if (!Number.isFinite(days) || days <= 0) throw new Error("--ttl-days must be positive");
      options.ttl = days * DAY;
    }
    console.log(JSON.stringify(importWebStressAttestations(store, documents, options), null, 2));
  } finally {
    store.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
