#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateBenchmark } from "./evaluate.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(ROOT, "v2/phase-8-acceptance.json");

export async function evaluateAcceptance(manifestPath = DEFAULT_MANIFEST) {
  const absoluteManifest = resolve(manifestPath);
  const manifestDir = dirname(absoluteManifest);
  const manifest = JSON.parse(await readFile(absoluteManifest, "utf8"));
  const benchmarkPath = resolve(manifestDir, manifest.benchmark);
  const runs = [];

  for (const descriptor of manifest.runs || []) {
    const scanPath = resolve(manifestDir, descriptor.scan);
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    const result = await evaluateBenchmark(benchmarkPath, {
      scanOverrides: new Map([[manifest.municipality_id, scanPath]]),
    });
    runs.push({
      ...descriptor,
      cache_hits: descriptor.cache_hits ?? countCacheHits(scan),
      scan_path: scanPath,
      publication_fingerprint: publicationFingerprint(scan),
      benchmark: result,
      gates: evaluateRunGates(result, scan, descriptor),
    });
  }

  const durability = evaluateDurabilityGates(manifest, runs);
  const allGates = [...runs.flatMap((run) => run.gates), ...durability];
  return {
    version: manifest.version,
    mode: manifest.mode,
    generated_from: absoluteManifest,
    rollout_decision: allGates.length > 0 && allGates.every((gate) => gate.passed) ? "go" : "no_go",
    summary: {
      runs: runs.length,
      passed_gates: allGates.filter((gate) => gate.passed).length,
      failed_gates: allGates.filter((gate) => !gate.passed).length,
    },
    runs,
    durability_gates: durability,
    failed_gates: allGates.filter((gate) => !gate.passed)
      .map(({ id, run_id, evidence }) => ({ id, ...(run_id ? { run_id } : {}), evidence })),
  };
}

export function evaluateRunGates(result, scan, descriptor = {}) {
  const metrics = result.metrics;
  const health = scan.acceptance_health || {};
  const attempts = collectSearchAttempts(scan);
  const targeted = Array.isArray(health.targeted_searches_per_unresolved_venue)
    ? health.targeted_searches_per_unresolved_venue : [];
  const sortedTargeted = [...targeted].sort((a, b) => a - b);
  const median = percentile(sortedTargeted, 0.5);
  const p95 = percentile(sortedTargeted, 0.95);
  const restaurants = scan.restaurants || [];
  const barhacca = findVenue(restaurants, "barhacca");
  const giardinetto = findVenue(restaurants, "al giardinetto", "giardinetto");
  const roleMetrics = Object.values(metrics.resource_role_by_role || {});
  const requestCost = metrics.request_cost || {};
  const baselineCalls = health.baseline_web_search_requests ?? 120;
  const callReduction = Number.isFinite(requestCost.web_search_requests)
    ? 1 - requestCost.web_search_requests / baselineCalls : null;
  const thirdSearches = Array.isArray(health.third_searches) ? health.third_searches : [];
  const providerYield = Array.isArray(health.provider_yield) ? health.provider_yield : [];

  return [
    gate("venue_precision", metrics.venue_admission.precision >= 0.98, metrics.venue_admission.precision),
    gate("venue_recall", metrics.venue_admission.recall >= 0.90, metrics.venue_admission.recall),
    gate("web_only_venue_recall", metrics.web_only_venue_recall >= 0.85, metrics.web_only_venue_recall),
    gate("official_website_precision", metrics.official_website.precision >= 0.98,
      metrics.official_website.precision),
    gate("official_website_recall", metrics.official_website.recall >= 0.85,
      metrics.official_website.recall),
    gate("resource_role_precision", metrics.resource_role.precision >= 0.95,
      metrics.resource_role.precision),
    gate("resource_role_precision_by_role", roleMetrics.length > 0
      && roleMetrics.every((item) => item.precision >= 0.90), metrics.resource_role_by_role || {}),
    gate("known_resource_recall", metrics.resource_role.recall >= 0.80,
      metrics.resource_role.recall),
    gate("barhacca_retained", Boolean(barhacca
      && canonicalUrl(barhacca.website) === canonicalUrl("https://www.barhacca.it/")
      && hasResource(barhacca, "https://www.barhacca.it/ordina/", "order")),
    barhacca ? "venue, website, and order link checked" : "venue missing"),
    gate("giardinetto_retained", Boolean(giardinetto
      && (giardinetto.aliases || []).some((item) => normalize(item) === "giardinetto")
      && canonicalUrl(giardinetto.website) === canonicalUrl("https://www.algiardinetto-oderzo.it/")
      && hasResource(giardinetto,
        "https://www.algiardinetto-oderzo.it/men%C3%B9-alla-carta/", "menu")),
    giardinetto ? "merged venue, website, and menu checked" : "venue missing"),
    gate("hard_negatives_unpublished", metrics.venue_admission.false_positives === 0
      && metrics.unlabeled_records === 0,
    { false_positives: metrics.venue_admission.false_positives,
      unlabeled_records: metrics.unlabeled_records }),
    gate("search_attempt_audit", attempts.length > 0 && attempts.every(validSearchAttempt),
      { attempts: attempts.length, invalid: attempts.filter((item) => !validSearchAttempt(item)).length }),
    gate("irrelevant_cache_safety", health.irrelevant_cached_as_success === 0,
      health.irrelevant_cached_as_success ?? "missing"),
    gate("scheduler_429_collisions", health.scheduler_429_collisions === 0,
      health.scheduler_429_collisions ?? "missing"),
    gate("broad_web_query_budget", Number.isInteger(health.broad_web_queries)
      && health.broad_web_queries <= 4, health.broad_web_queries ?? "missing"),
    gate("targeted_search_distribution", targeted.length > 0 && median <= 1 && p95 <= 2,
      { samples: targeted.length, median, p95 }),
    gate("per_venue_search_budget", targeted.length > 0 && targeted.every((count) => count <= 3)
      && thirdSearches.every((item) => item?.budget_escalation_reason),
    { maximum: targeted.length ? Math.max(...targeted) : null, third_searches: thirdSearches.length,
      missing_escalation_reasons: thirdSearches.filter((item) => !item?.budget_escalation_reason).length }),
    gate("web_search_reduction", callReduction !== null && callReduction >= 0.50,
      { calls: requestCost.web_search_requests ?? null, baseline: baselineCalls, reduction: callReduction }),
    gate("provider_yield_reported", providerYield.length > 0 && providerYield.every((item) =>
      item?.provider && item?.purpose && Number.isInteger(item.useful_candidates)
      && Number.isInteger(item.accepted_sites) && Number.isInteger(item.accepted_resources)),
    { rows: providerYield.length }),
    gate("degraded_provider_health", health.degraded_provider_claimed_healthy === false,
      health.degraded_provider_claimed_healthy ?? "missing"),
    gate("provider_manifest_saved", Boolean((descriptor.provider_manifest
      && typeof descriptor.provider_manifest === "object") || (scan.provider_manifest
      && typeof scan.provider_manifest === "object")), descriptor.provider_manifest
      || scan.provider_manifest || "missing"),
    gate("elapsed_time_saved", Number.isFinite(descriptor.elapsed_ms ?? scan.elapsed_ms)
      && (descriptor.elapsed_ms ?? scan.elapsed_ms) >= 0,
      descriptor.elapsed_ms ?? scan.elapsed_ms ?? "missing"),
    gate("schema_and_provenance", health.schema_validated === true
      && health.provenance_validated === true,
    { schema_validated: health.schema_validated ?? false,
      provenance_validated: health.provenance_validated ?? false }),
  ].map((item) => ({ ...item, run_id: descriptor.id }));
}

export function evaluateDurabilityGates(manifest, runs) {
  const cold = runs.filter((run) => run.cache_mode === "cold");
  const warm = runs.filter((run) => run.cache_mode === "warm");
  const runPassed = (run) => run.gates.every((item) => item.passed);
  const reference = cold.at(-1)?.publication_fingerprint;
  return [
    gate("live_acceptance_mode", manifest.mode === "live-isolated",
      `mode=${manifest.mode || "missing"}`),
    gate("two_cold_runs", cold.length >= 2 && cold.slice(-2).every(runPassed),
      { count: cold.length, passing: cold.filter(runPassed).length }),
    gate("warm_cache_run", warm.length >= 1 && warm.some((run) => runPassed
      && run.publication_fingerprint === reference
      && (run.cache_hits || 0) > 0),
    { count: warm.length, cache_hits: warm.map((run) => run.cache_hits ?? null) }),
    gate("transient_outage_durability", manifest.transient_outage?.passed === true
      && manifest.transient_outage?.last_known_good_visible === true,
    manifest.transient_outage || "missing"),
    gate("manual_review_complete", manifest.manual_review?.new_acceptances_reviewed === true
      && manifest.manual_review?.lost_known_facts_reviewed === true,
    manifest.manual_review || "missing"),
    gate("v1_fixture_integrity", manifest.v1_fixture_integrity?.preserved === true
      && Boolean(manifest.v1_fixture_integrity?.sha256),
    manifest.v1_fixture_integrity || "missing"),
  ];
}

function collectSearchAttempts(scan) {
  return [
    ...(scan.search_attempts || []),
    ...(scan.source_runs || []).flatMap((run) => run.search_attempts || []),
    ...(scan.restaurants || []).flatMap((item) => item.enrichment_run?.search_attempts || []),
    ...(scan.restaurants || []).flatMap((item) => item.enrichment_run?.resource_search_attempts || []),
  ];
}

function countCacheHits(scan) {
  const responseHits = collectSearchAttempts(scan)
    .filter((attempt) => attempt.cache?.status === "hit").length;
  const crawlHits = (scan.restaurants || []).reduce((sum, item) =>
    sum + (item.enrichment_run?.crawl_cache_hits || 0), 0);
  return responseHits + crawlHits;
}

function validSearchAttempt(attempt) {
  if (!attempt?.query || !(attempt.purpose || attempt.kind) || !attempt.outcome
      || !attempt.cache?.status || !Array.isArray(attempt.attempts) || !attempt.attempts.length) return false;
  return attempt.attempts.every((item) => item?.provider
    && Object.hasOwn(item, "http_status") && Number.isFinite(item.duration_ms)
    && (item.outcome || item.reason));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  return values[Math.ceil(values.length * fraction) - 1];
}

function findVenue(restaurants, ...names) {
  const wanted = new Set(names.map(normalize));
  return restaurants.find((item) => [item.name, ...(item.aliases || [])]
    .some((name) => wanted.has(normalize(name))));
}

function hasResource(restaurant, url, role) {
  return (restaurant.resources || []).some((item) => canonicalUrl(item.url) === canonicalUrl(url)
    && item.role === role);
}

function publicationFingerprint(scan) {
  const rows = (scan.restaurants || []).map((item) => ({
    name: normalize(item.name),
    website: item.website_kind === "official" ? canonicalUrl(item.website) : null,
    resources: (item.resources || []).map((resource) =>
      ({ url: canonicalUrl(resource.url), role: resource.role })).sort((a, b) =>
      `${a.url}:${a.role}`.localeCompare(`${b.url}:${b.role}`)),
  })).sort((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return String(value || ""); }
}

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function gate(id, passed, evidence) {
  return { id, passed: Boolean(passed), evidence };
}

function format(result) {
  const lines = [
    `Phase 8 acceptance: ${result.rollout_decision.toUpperCase().replace("_", "-")}`,
    `Mode: ${result.mode}`,
    `Runs: ${result.summary.runs}; gates: ${result.summary.passed_gates} passed, ${result.summary.failed_gates} failed`,
  ];
  for (const failure of result.failed_gates) {
    lines.push(`FAIL ${failure.run_id ? `${failure.run_id}/` : ""}${failure.id}: ${JSON.stringify(failure.evidence)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  let manifestPath = DEFAULT_MANIFEST;
  let outputPath = null;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--manifest") manifestPath = args[++index];
    else if (args[index] === "--output") outputPath = args[++index];
    else if (args[index] === "--json") json = true;
    else throw new Error(`unknown argument: ${args[index]}`);
  }
  const result = await evaluateAcceptance(manifestPath);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await writeFile(resolve(outputPath), serialized, "utf8");
  process.stdout.write(json ? serialized : format(result));
  if (result.rollout_decision !== "go") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
