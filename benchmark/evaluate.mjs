#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BENCHMARK = resolve(ROOT, "v1/benchmark.json");

export async function evaluateBenchmark(benchmarkPath = DEFAULT_BENCHMARK, options = {}) {
  const absolutePath = resolve(benchmarkPath);
  const benchmark = await readBenchmark(absolutePath);
  const benchmarkDir = dirname(absolutePath);
  const totals = emptyCounts();
  const municipalities = [];
  const extended = benchmark.evaluator_version >= 2;

  for (const fixture of benchmark.municipalities) {
    const scanPath = options.scanOverrides?.get(fixture.id) || resolve(benchmarkDir, fixture.scan);
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    const result = evaluateMunicipality(fixture, scan, extended);
    addCounts(totals, result.counts);
    municipalities.push(result);
  }

  const metrics = metricsFromCounts(totals, extended);
  if (extended) metrics.request_cost = sumRequestCosts(municipalities.map((item) => requestCost(item.scan_summary)));

  return {
    benchmark_version: benchmark.version,
    evaluator_version: benchmark.evaluator_version || 1,
    configuration: benchmark.configuration,
    provenance: benchmark.provenance,
    metrics,
    errors: {
      false_positives: municipalities.flatMap((item) => item.errors.false_positives),
      false_negatives: municipalities.flatMap((item) => item.errors.false_negatives),
      website_errors: municipalities.flatMap((item) => item.errors.website_errors),
      resource_errors: municipalities.flatMap((item) => item.errors.resource_errors),
      unresolved_duplicates: municipalities.flatMap((item) => item.errors.unresolved_duplicates),
      unlabeled_records: municipalities.flatMap((item) => item.errors.unlabeled_records),
    },
    municipalities: municipalities.map(({ counts, scan_summary, ...item }) => ({
      ...item,
      metrics: metricsFromCounts(counts, extended),
      request_cost: requestCost(scan_summary),
    })),
  };
}

async function readBenchmark(absolutePath) {
  const raw = JSON.parse(await readFile(absolutePath, "utf8"));
  if (!raw.extends) return hydrateTruthSets(raw, dirname(absolutePath));
  const base = await readBenchmark(resolve(dirname(absolutePath), raw.extends));
  const scanOverrides = raw.scan_overrides || {};
  return {
    ...base,
    ...raw,
    configuration: { ...base.configuration, ...raw.configuration },
    provenance: { ...base.provenance, ...raw.provenance },
    municipalities: base.municipalities.map((fixture) => ({
      ...fixture,
      scan: scanOverrides[fixture.id] || fixture.scan,
    })),
  };
}

async function hydrateTruthSets(benchmark, benchmarkDir) {
  const municipalities = await Promise.all((benchmark.municipalities || []).map(async (fixture) => {
    if (!fixture.truth_set) return fixture;
    const truth = JSON.parse(await readFile(resolve(benchmarkDir, fixture.truth_set), "utf8"));
    const cases = [
      ...truth.venues.map((venue) => ({
        id: venue.id,
        selector: venue.selector || { name: venue.name },
        expected: {
          venue: venue.status === "current" ? "accepted" : "rejected",
          canonical_venue_id: venue.status === "current" ? venue.id : null,
          aliases: venue.aliases || [venue.name],
          source_class: venue.source_class,
          official_websites: venue.official_websites || [],
          resources: venue.resources || [],
        },
      })),
      ...(truth.hard_negatives || []).map((item) => ({
        id: item.id, selector: item.selector || { name: item.name },
        expected: { venue: "rejected", canonical_venue_id: null, aliases: [], official_websites: [], resources: [] },
      })),
    ];
    return { ...fixture, cases, truth_set_version: truth.version };
  }));
  return { ...benchmark, municipalities };
}

function evaluateMunicipality(fixture, scan, extended = false) {
  const counts = emptyCounts();
  const errors = {
    false_positives: [], false_negatives: [], website_errors: [],
    resource_errors: [], unresolved_duplicates: [], unlabeled_records: [],
  };
  const records = Array.isArray(scan.restaurants) ? scan.restaurants : [];
  const matchedIndexes = new Set();
  const matchedIndexByCase = new Map();

  for (const labelledCase of fixture.cases) {
    const matches = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => matchesSelector(record, labelledCase.selector));
    if (matches.length > 1) {
      throw new Error(`${fixture.id}/${labelledCase.id}: selector matched multiple records`);
    }
    const match = matches[0];
    if (match) matchedIndexes.add(match.index);
    matchedIndexByCase.set(labelledCase.id, match?.index);
    const accepted = labelledCase.expected.venue === "accepted";
    if (match && accepted) counts.venue.tp++;
    else if (match) {
      counts.venue.fp++;
      errors.false_positives.push(caseRef(fixture, labelledCase));
    } else if (accepted) {
      counts.venue.fn++;
      errors.false_negatives.push(caseRef(fixture, labelledCase));
    } else counts.venue.tn++;

    if (extended && accepted) {
      const sourceClass = labelledCase.expected.source_class || "unclassified";
      const sourceCounts = counts.venue_by_source[sourceClass] ||= { tp: 0, fn: 0 };
      if (match) sourceCounts.tp++;
      else sourceCounts.fn++;
    }

    evaluateWebsite(fixture, labelledCase, match?.record, counts, errors);
    evaluateResources(fixture, labelledCase, match?.record, counts, errors, extended);
  }

  records.forEach((record, index) => {
    if (!matchedIndexes.has(index)) {
      counts.unlabeled++;
      errors.unlabeled_records.push(`${fixture.id}/${record.name || `record-${index}`}`);
    }
  });

  const groups = new Map();
  for (const item of fixture.cases.filter((entry) => entry.expected.venue === "accepted")) {
    const key = item.expected.canonical_venue_id;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  for (const [canonicalId, cases] of groups) {
    if (!canonicalId || cases.length < 2) continue;
    counts.duplicates.groups++;
    const presentIndexes = cases.map((item) => matchedIndexByCase.get(item.id))
      .filter((index) => index !== undefined);
    if (new Set(presentIndexes).size > 1) {
      counts.duplicates.unresolved++;
      errors.unresolved_duplicates.push(`${fixture.id}/${canonicalId}`);
    } else if (presentIndexes.length > 0) counts.duplicates.resolved++;
    else {
      counts.duplicates.unresolved++;
      errors.unresolved_duplicates.push(`${fixture.id}/${canonicalId}`);
    }
  }

  return {
    id: fixture.id,
    location: scan.location,
    stratum: fixture.stratum,
    scan_summary: scan,
    counts,
    errors,
  };
}

function evaluateWebsite(fixture, labelledCase, record, counts, errors) {
  const expected = new Set((labelledCase.expected.official_websites || []).map(canonicalUrl));
  const predicted = record?.website_kind === "official" && record.website
    ? canonicalUrl(record.website) : null;
  if (predicted && expected.has(predicted) && labelledCase.expected.venue === "accepted") {
    counts.website.tp++;
  } else if (predicted) {
    counts.website.fp++;
    errors.website_errors.push(`${caseRef(fixture, labelledCase)}: unexpected ${record.website}`);
  }
  if (expected.size && !predicted) {
    counts.website.fn++;
    errors.website_errors.push(`${caseRef(fixture, labelledCase)}: missing official website`);
  } else if (expected.size && predicted && !expected.has(predicted)) {
    counts.website.fn++;
  }
}

function evaluateResources(fixture, labelledCase, record, counts, errors, extended = false) {
  const expected = new Map((labelledCase.expected.resources || [])
    .map((item) => [canonicalUrl(item.url), item.role]));
  const seen = new Set();
  const matched = new Set();
  for (const resource of record?.resources || []) {
    const url = canonicalUrl(resource.url);
    seen.add(url);
    if (labelledCase.expected.venue === "accepted" && expected.get(url) === resource.role) {
      counts.resource.tp++;
      roleCounts(counts, resource.role).tp++;
      matched.add(url);
    } else {
      counts.resource.fp++;
      roleCounts(counts, resource.role || "unknown").fp++;
      const suffix = expected.has(url) ? `wrong role ${resource.role}` : `unexpected ${resource.url}`;
      errors.resource_errors.push(`${caseRef(fixture, labelledCase)}: ${suffix}`);
    }
  }
  for (const [url] of expected) {
    if (!(extended ? matched : seen).has(url)) {
      counts.resource.fn++;
      roleCounts(counts, expected.get(url)).fn++;
      errors.resource_errors.push(`${caseRef(fixture, labelledCase)}: missing ${url}`);
    }
  }
}

function matchesSelector(record, selector) {
  const names = [record.name, ...(record.aliases || [])].map(normalize);
  if (!names.includes(normalize(selector.name))) return false;
  if (!selector.osm_id) return true;
  if (record.osm_id === selector.osm_id) return true;
  return (record.source_records || []).some((item) => item.source_id === selector.osm_id);
}

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return String(value || "");
  }
}

function caseRef(fixture, labelledCase) {
  return `${fixture.id}/${labelledCase.id}`;
}

function emptyCounts() {
  return {
    venue: { tp: 0, fp: 0, fn: 0, tn: 0 },
    website: { tp: 0, fp: 0, fn: 0 },
    resource: { tp: 0, fp: 0, fn: 0 },
    duplicates: { groups: 0, resolved: 0, unresolved: 0 },
    venue_by_source: {},
    resource_by_role: {},
    unlabeled: 0,
  };
}

function addCounts(target, source) {
  for (const key of ["venue", "website", "resource", "duplicates"]) {
    for (const [metric, value] of Object.entries(source[key])) target[key][metric] += value;
  }
  target.unlabeled += source.unlabeled;
  for (const [sourceClass, values] of Object.entries(source.venue_by_source)) {
    const bucket = target.venue_by_source[sourceClass] ||= { tp: 0, fn: 0 };
    bucket.tp += values.tp; bucket.fn += values.fn;
  }
  for (const [role, values] of Object.entries(source.resource_by_role)) {
    const bucket = target.resource_by_role[role] ||= { tp: 0, fp: 0, fn: 0 };
    bucket.tp += values.tp; bucket.fp += values.fp; bucket.fn += values.fn;
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function metricsFromCounts(counts, extended = false) {
  const metrics = {
    venue_admission: {
      precision: ratio(counts.venue.tp, counts.venue.tp + counts.venue.fp),
      recall: ratio(counts.venue.tp, counts.venue.tp + counts.venue.fn),
      false_positives: counts.venue.fp,
      false_negatives: counts.venue.fn,
    },
    official_website: {
      precision: ratio(counts.website.tp, counts.website.tp + counts.website.fp),
      recall: ratio(counts.website.tp, counts.website.tp + counts.website.fn),
    },
    resource_role: {
      precision: ratio(counts.resource.tp, counts.resource.tp + counts.resource.fp),
      recall: ratio(counts.resource.tp, counts.resource.tp + counts.resource.fn),
    },
    duplicates: { ...counts.duplicates },
    unlabeled_records: counts.unlabeled,
  };
  if (extended) {
    metrics.venue_recall_by_source = Object.fromEntries(Object.entries(counts.venue_by_source)
      .map(([sourceClass, value]) => [sourceClass, ratio(value.tp, value.tp + value.fn)]));
    metrics.web_only_venue_recall = metrics.venue_recall_by_source.web_only ?? null;
    metrics.resource_role_by_role = Object.fromEntries(Object.entries(counts.resource_by_role)
      .map(([role, value]) => [role, {
        precision: ratio(value.tp, value.tp + value.fp),
        recall: ratio(value.tp, value.tp + value.fn),
        ...value,
      }]));
  }
  return metrics;
}

function roleCounts(counts, role) {
  return counts.resource_by_role[role] ||= { tp: 0, fp: 0, fn: 0 };
}

function requestCost(scan) {
  if (!scan) return null;
  const explicit = scan.request_cost || {};
  const enrichment = scan.enrichment_run || {};
  const townSearches = explicit.town_search_requests ?? explicit.discovery_search_requests ?? 0;
  const targeted = explicit.targeted_search_requests ?? enrichment.search_requests ?? 0;
  const total = explicit.web_search_requests ?? townSearches + targeted;
  if (!total && !enrichment.crawl_requests && !enrichment.resource_validation_requests) return null;
  return {
    web_search_requests: total,
    town_search_requests: townSearches,
    targeted_search_requests: targeted,
    crawl_requests: explicit.crawl_requests ?? enrichment.crawl_requests ?? 0,
    resource_validation_requests: explicit.resource_validation_requests
      ?? enrichment.resource_validation_requests ?? 0,
  };
}

function sumRequestCosts(costs) {
  const present = costs.filter(Boolean);
  if (!present.length) return null;
  return present.reduce((total, item) => {
    for (const [key, value] of Object.entries(item)) total[key] = (total[key] || 0) + value;
    return total;
  }, {});
}

function formatSummary(result) {
  const percent = (value) => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const metrics = result.metrics;
  const lines = [
    `Benchmark ${result.benchmark_version} (evaluator ${result.evaluator_version})`,
    `Venue admission: precision ${percent(metrics.venue_admission.precision)}, recall ${percent(metrics.venue_admission.recall)} (${metrics.venue_admission.false_positives} FP, ${metrics.venue_admission.false_negatives} FN)`,
    `Official websites: precision ${percent(metrics.official_website.precision)}, recall ${percent(metrics.official_website.recall)}`,
    `Resource roles: precision ${percent(metrics.resource_role.precision)}, recall ${percent(metrics.resource_role.recall)}`,
    `Duplicates: ${metrics.duplicates.resolved}/${metrics.duplicates.groups} resolved, ${metrics.duplicates.unresolved} unresolved`,
    `Unlabelled output records: ${metrics.unlabeled_records}`,
  ];
  if (metrics.venue_recall_by_source) {
    lines.push(`Venue recall by source: ${Object.entries(metrics.venue_recall_by_source)
      .map(([source, value]) => `${source} ${percent(value)}`).join(", ")}`);
  }
  if (metrics.resource_role_by_role) {
    lines.push(`Resource roles: ${Object.entries(metrics.resource_role_by_role)
      .map(([role, value]) => `${role} P ${percent(value.precision)} / R ${percent(value.recall)}`).join(", ")}`);
  }
  if (metrics.request_cost) lines.push(`Request cost: ${metrics.request_cost.web_search_requests} web searches, ${metrics.request_cost.crawl_requests} crawls, ${metrics.request_cost.resource_validation_requests} resource validations`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let benchmarkPath = DEFAULT_BENCHMARK;
  let outputPath = null;
  let json = false;
  const scanOverrides = new Map();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--benchmark") benchmarkPath = args[++i];
    else if (args[i] === "--output") outputPath = args[++i];
    else if (args[i] === "--scan") {
      const value = args[++i] || "";
      const separator = value.indexOf("=");
      if (separator < 1) throw new Error("--scan must be municipality-id=path");
      scanOverrides.set(value.slice(0, separator), resolve(value.slice(separator + 1)));
    }
    else if (args[i] === "--json") json = true;
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  const result = await evaluateBenchmark(benchmarkPath, { scanOverrides });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await writeFile(resolve(outputPath), serialized, "utf8");
  process.stdout.write(json ? serialized : `${formatSummary(result)}\n`);
  if (result.metrics.unlabeled_records > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
