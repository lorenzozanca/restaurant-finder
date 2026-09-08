import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { enrichSelectedAttested } from "./enrich-attested.mjs";

test("selected attested crawl is bounded, search-free, and records accepted facts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "enrich-attested-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const venueId = "venue:test:attested";
  const store = new EvidenceStore(db, { clock: () => new Date("2026-09-08T00:00:00Z") });
  store.rememberVenue({ canonical_venue_id: venueId, name: "Attested Venue",
    source_records: [{ source_record_id: "fixture:1", source: "fixture", name: "Attested Venue",
      municipality: "Torino", postcode: "10100", province_code: "TO",
      website: "https://attested.example/" }] }, { municipality: "Torino" });
  store.recordPublisherAttestation(venueId, { status: "verified",
    method: "manual_first_party_review", venue_id: venueId,
    website_url: "https://attested.example/", evidence_urls: ["https://attested.example/contact"],
    reviewer: "fixture", reviewed_at: "2026-09-08T00:00:00Z",
    expires_at: "2027-09-08T00:00:00Z", source_kind: "human_review" },
  { recordedAt: "2026-09-08T00:00:00Z" });
  store.close();

  let calls = 0;
  const result = await enrichSelectedAttested({ dbPath: db, venueIds: [venueId, venueId],
    cacheDir: join(directory, "cache") }, { enrich: async (venue, location, options) => {
      calls++;
      assert.equal(venue.publisher_ownership.length, 1);
      assert.equal(location.province_code, "TO");
      assert.deepEqual(options.resolverBudget, { searches: 0, crawls: 3 });
      assert.equal(options.resourceBudget.siteSearch, false);
      return { website: "https://attested.example/", website_confidence: "high",
        website_decision: { status: "accepted" }, resources: [], resource_decisions: [],
        enrichment_run: { resolver_status: "accepted", resolver_stop_reason: "official_site_accepted",
          search_requests: 0, crawl_requests: 1, search_attempts: [], crawl_attempts: [] } };
    } });
  assert.equal(calls, 1);
  assert.equal(result.selected, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.search_requests, 0);
  assert.equal(result.resource_site_search_requests, 0);

  const reopened = new EvidenceStore(db);
  assert.equal(reopened.auditFacts(venueId).filter((fact) => fact.kind === "website").length, 1);
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs").get().count, 0);
  reopened.close();
});

test("selected crawl rejects unattested venues before calling enrichment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "enrich-unattested-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const store = new EvidenceStore(db);
  store.rememberVenue({ canonical_venue_id: "venue:test:plain", name: "Plain",
    source_records: [{ source_record_id: "fixture:plain", source: "fixture", name: "Plain",
      website: "https://plain.example/" }] });
  store.close();
  let called = false;
  await assert.rejects(enrichSelectedAttested({ dbPath: db, venueIds: ["venue:test:plain"] },
    { enrich: async () => { called = true; } }), /no active publisher attestation/);
  assert.equal(called, false);
});
