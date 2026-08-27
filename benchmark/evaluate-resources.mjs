#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateResourceCandidate } from "../find-menu.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(ROOT, "v1/session-7-resources.json");

export async function evaluateResources(fixturePath = DEFAULT_FIXTURE) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
  const cases = fixture.cases.map((item) => {
    const decision = validateResourceCandidate(
      item.candidate, item.restaurant, item.location, item.official_website, item.response,
    );
    return {
      id: item.id,
      expected_status: item.expected_status,
      expected_role: item.expected_role,
      actual_status: decision.status,
      actual_role: decision.role,
      evidence: decision.evidence,
      passed: decision.status === item.expected_status && decision.role === item.expected_role,
    };
  });
  const roles = [...new Set(fixture.cases.filter((item) => item.expected_status === "accepted").map((item) => item.expected_role))];
  const byRole = Object.fromEntries(roles.map((role) => {
    const predicted = cases.filter((item) => item.actual_status === "accepted" && item.actual_role === role);
    const truePositive = predicted.filter((item) => item.expected_status === "accepted" && item.expected_role === role).length;
    const labelled = cases.filter((item) => item.expected_status === "accepted" && item.expected_role === role).length;
    return [role, {
      precision: predicted.length ? truePositive / predicted.length : null,
      recall: labelled ? truePositive / labelled : null,
      published: predicted.length,
      labelled,
    }];
  }));
  const published = cases.filter((item) => item.actual_status === "accepted");
  const correctPublished = published.filter((item) => item.expected_status === "accepted" && item.actual_role === item.expected_role);
  return {
    benchmark_version: fixture.version,
    cases,
    metrics: {
      published_resource_precision: published.length ? correctPublished.length / published.length : null,
      hard_negative_publications: cases.filter((item) => item.expected_status === "rejected" && item.actual_status === "accepted").length,
      by_role: byRole,
    },
  };
}

async function main() {
  const result = await evaluateResources(process.argv[2] || DEFAULT_FIXTURE);
  const percent = (value) => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  process.stdout.write(`Resource benchmark ${result.benchmark_version}\n`);
  process.stdout.write(`Published precision: ${percent(result.metrics.published_resource_precision)}\n`);
  for (const [role, metric] of Object.entries(result.metrics.by_role)) {
    process.stdout.write(`${role}: ${percent(metric.precision)} precision, ${percent(metric.recall)} recall\n`);
  }
  process.stdout.write(`Hard-negative publications: ${result.metrics.hard_negative_publications}\n`);
  if (result.cases.some((item) => !item.passed)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
