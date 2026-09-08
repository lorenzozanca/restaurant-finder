import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test from "node:test";
import { EvidenceStore } from "../lib/evidence-store.mjs";
import { handle } from "./server.mjs";

test("review HTTP endpoints advance rejected candidates without publishing facts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "review-server-"));
  const db = join(directory, "store.sqlite");
  const priorPath = process.env.EVIDENCE_DB_PATH;
  process.env.EVIDENCE_DB_PATH = db;
  const store = new EvidenceStore(db);
  store.rememberVenue({
    canonical_venue_id: "venue:http:review", name: "HTTP Review",
    source_records: [
      { source_record_id: "overture:http", source: "overture_places",
        name: "HTTP Review", website: "https://directory.example/listing" },
      { source_record_id: "osm:http", source: "openstreetmap",
        name: "HTTP Review", website: "https://official.example/" },
    ],
  }, { checkedAt: "2026-09-01T00:00:00.000Z", municipality: "Torino" });
  store.close();

  t.after(async () => {
    if (priorPath === undefined) delete process.env.EVIDENCE_DB_PATH;
    else process.env.EVIDENCE_DB_PATH = priorPath;
    await rm(directory, { recursive: true, force: true });
  });

  const page = await request("GET", "/review.html");
  assert.equal(page.status, 200);
  assert.match(page.headers["Content-Type"], /^text\/html/);

  const firstResponse = await request("GET", "/api/review/next");
  assert.equal(firstResponse.status, 200);
  const first = JSON.parse(firstResponse.body);
  assert.equal(first.candidate_domain, "directory.example");
  assert.equal(first.queue_remaining, 2);

  const malformed = await request("POST", "/api/review/decision", "not-json");
  assert.equal(malformed.status, 400);

  const forbiddenRegistry = await request("POST", "/api/review/decision", JSON.stringify({
    venue_id: first.venue_id, candidate_domain: first.candidate_domain,
    decision: "approve", website_url: first.candidate_url,
    evidence_urls: [first.candidate_url], reviewer: "http-reviewer",
    method: "official_registry",
  }));
  assert.equal(forbiddenRegistry.status, 400);
  assert.match(JSON.parse(forbiddenRegistry.body).error, /manual_first_party_review/);

  const rejection = await request("POST", "/api/review/decision", JSON.stringify({
    venue_id: first.venue_id, candidate_domain: first.candidate_domain,
    decision: "reject", website_url: first.candidate_url,
    evidence_urls: [first.candidate_url], reviewer: "http-reviewer",
    method: "manual_first_party_review",
  }));
  assert.equal(rejection.status, 200);
  assert.equal(JSON.parse(rejection.body).status, "rejected");

  const next = JSON.parse((await request("GET", "/api/review/next")).body);
  assert.equal(next.candidate_domain, "official.example");
  assert.equal(next.queue_remaining, 1);

  const correctedApproval = await request("POST", "/api/review/decision", JSON.stringify({
    venue_id: next.venue_id, candidate_domain: next.candidate_domain,
    decision: "approve", website_url: "https://corrected.example/",
    evidence_urls: ["https://corrected.example/contatti"], reviewer: "http-reviewer",
    method: "manual_first_party_review",
  }));
  assert.equal(correctedApproval.status, 200);
  assert.equal(JSON.parse(correctedApproval.body).publisher_domain, "corrected.example");

  const reopened = new EvidenceStore(db);
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM facts").get().count, 0);
  reopened.close();

  process.env.EVIDENCE_DB_PATH = join(directory, "missing.sqlite");
  const missing = await request("GET", "/api/review/next");
  assert.equal(missing.status, 503);
});

function request(method, url, body = "") {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = { host: "localhost" };
    const response = { status: 0, headers: {}, body: "" };
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        response.status = status;
        response.headers = headers || {};
        this.headersSent = true;
      },
      end(chunk = "") {
        response.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        resolve(response);
      },
    };
    handle(req, res).catch(reject);
  });
}
