#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findMenuSources } from "../find-menu.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(ROOT, "v1/session-5-enrichment.json");

export async function evaluateEnrichment(fixturePath = DEFAULT_FIXTURE) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
  const cases = [];
  let acceptedLinks = 0;
  let expectedLinks = 0;
  let searchRequests = 0;

  for (const item of fixture.cases) {
    const search = async () => [];
    const get = async (url) => {
      const expectedResource = item.expected.find((resource) => resource.url === url);
      return url === item.restaurant.website
        ? { ok: true, status: 200, body: item.page, final_url: url, content_type: "text/html" }
        : expectedResource
          ? {
            ok: true,
            status: 200,
            body: `${item.restaurant.name} ${item.location} ${expectedResource?.role || "menu"}`,
            final_url: url,
            content_type: url.includes(".pdf") ? "application/pdf" : "text/html",
          }
          : { ok: false, status: 404, body: "", final_url: url };
    };
    const result = await findMenuSources(item.restaurant, item.location, {
      search,
      get,
      getRendered: async () => ({ ok: false, body: "" }),
      crawlCache: new Map(),
    });
    const actual = result.resources.map(({ url, role }) => ({ url, role }));
    const passed = JSON.stringify(actual) === JSON.stringify(item.expected);
    expectedLinks += item.expected.length;
    if (passed) acceptedLinks += actual.length;
    searchRequests += result.enrichment_run.search_requests;
    cases.push({ id: item.id, passed, expected: item.expected, actual, enrichment_run: result.enrichment_run });
  }

  const baseline = fixture.search_first_baseline_requests;
  return {
    benchmark_version: fixture.version,
    cases,
    metrics: {
      accepted_links: acceptedLinks,
      expected_links: expectedLinks,
      link_recall: expectedLinks ? acceptedLinks / expectedLinks : null,
      search_first_baseline_requests: baseline,
      website_first_search_requests: searchRequests,
      search_request_reduction: baseline ? (baseline - searchRequests) / baseline : null,
    },
  };
}

async function main() {
  const fixturePath = process.argv[2] || DEFAULT_FIXTURE;
  const result = await evaluateEnrichment(fixturePath);
  const percent = (value) => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  process.stdout.write([
    `Enrichment benchmark ${result.benchmark_version}`,
    `Links: ${result.metrics.accepted_links}/${result.metrics.expected_links} (${percent(result.metrics.link_recall)} recall)`,
    `Search requests: ${result.metrics.website_first_search_requests} website-first vs ${result.metrics.search_first_baseline_requests} search-first baseline (${percent(result.metrics.search_request_reduction)} reduction)`,
  ].join("\n") + "\n");
  if (result.cases.some((item) => !item.passed)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
