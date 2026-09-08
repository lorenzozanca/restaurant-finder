import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assessLabelledCorpus } from "./assess-labelled-corpus.mjs";

test("labelled assessor is zero-search, persistent, and resumable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "labelled-assessor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = { schema_version: 1, fixture_set: "test", source: "codex_integrated_web_search",
    brave_requests_made: 0, selection_fingerprint_sha256: "a".repeat(64), bounded_result_limit: 5,
    entries: [{ venue_id: "venue:test", name: "Venue Test", municipality: "Roma", region: "Lazio",
      address: "Via Roma 1", partition: "development", query: "Venue Test Roma",
      retrieved_at: "2026-09-01T00:00:00Z", candidates: [
        { title: "Venue Test ristorante Roma Via Roma 1", url: "https://venue.test/" },
        { title: "Venue Test", url: "https://facebook.com/venue.test" },
      ], adjudication: null }],
  };
  await writeFile(join(directory, "development-001-001.json"), JSON.stringify(fixture));
  let crawls = 0;
  const options = { partition: "development", fixtureDirectories: [directory],
    dbPath: join(directory, "assessments.sqlite"), cacheDir: join(directory, "cache"), concurrency: 2 };
  const dependencies = { clock: () => "2026-09-08T00:00:00Z", crawl: async (url) => {
    crawls++;
    return { status: "succeeded", final_url: url, resources: [], site_facts: {
      text: "Venue Test ristorante Roma Via Roma 1", structured_types: ["Restaurant"],
    } };
  } };
  const first = await assessLabelledCorpus(options, dependencies);
  assert.equal(crawls, 1, "unsupported publishers are classified without fetching");
  assert.equal(first.assessed_now, 2);
  assert.deepEqual(first.assessment_counts, { strongly_correlated: 1, ambiguous: 0,
    contradicted: 0, retryable: 0, unsupported_publisher: 1 });
  const second = await assessLabelledCorpus(options, dependencies);
  assert.equal(second.assessed_now, 0);
  assert.equal(second.resumed_existing, 2);
  assert.equal(crawls, 1);
});
