#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreOfficialWebsite } from "../find-menu.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(ROOT, "v1/session-6-websites.json");

export async function evaluateWebsites(fixturePath = DEFAULT_FIXTURE) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
  const cases = fixture.cases.map((item) => {
    const decision = scoreOfficialWebsite(item.candidate, item.restaurant, item.location);
    return {
      id: item.id,
      label: item.label,
      expected: item.expected,
      actual: decision.outcome,
      confidence: decision.confidence,
      scores: decision.scores,
      evidence: decision.reasons,
      passed: decision.outcome === item.expected,
    };
  });
  const publishable = cases.filter((item) => item.actual === "accepted");
  const labelledPositive = cases.filter((item) => item.label === "official");
  const truePositive = publishable.filter((item) => item.label === "official");
  const high = publishable.filter((item) => item.confidence === "high");
  const medium = publishable.filter((item) => item.confidence === "medium");
  const precision = (items) => items.length
    ? items.filter((item) => item.label === "official").length / items.length : null;
  return {
    benchmark_version: fixture.version,
    thresholds: fixture.thresholds,
    cases,
    metrics: {
      official_website_precision: precision(publishable),
      official_website_recall: labelledPositive.length ? truePositive.length / labelledPositive.length : null,
      accepted: publishable.length,
      review: cases.filter((item) => item.actual === "review").length,
      rejected: cases.filter((item) => item.actual === "rejected").length,
      high_confidence_precision: precision(high),
      medium_confidence_precision: precision(medium),
    },
  };
}

async function main() {
  const result = await evaluateWebsites(process.argv[2] || DEFAULT_FIXTURE);
  const percent = (value) => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  process.stdout.write([
    `Website benchmark ${result.benchmark_version}`,
    `Official websites: ${percent(result.metrics.official_website_precision)} precision, ${percent(result.metrics.official_website_recall)} recall`,
    `Outcomes: ${result.metrics.accepted} accepted, ${result.metrics.review} review, ${result.metrics.rejected} rejected`,
    `Confidence precision: high ${percent(result.metrics.high_confidence_precision)}, medium ${percent(result.metrics.medium_confidence_precision)}`,
  ].join("\n") + "\n");
  if (result.cases.some((item) => !item.passed)
      || (result.metrics.official_website_precision ?? 0) < 0.95) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
