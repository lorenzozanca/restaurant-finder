import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { writeMapSnapshot } from "../lib/map-snapshot.mjs";
import { leadFixtureStore } from "../lib/national-leads.fixture.mjs";
import { handle } from "./server.mjs";

test("national lead map endpoints serve compressed, versioned data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "national-server-"));
  const db = join(directory, "national.sqlite");
  const priorPath = process.env.NATIONAL_DB_PATH;
  process.env.NATIONAL_DB_PATH = db;
  leadFixtureStore(db);
  writeMapSnapshot(db);
  t.after(async () => {
    if (priorPath === undefined) delete process.env.NATIONAL_DB_PATH;
    else process.env.NATIONAL_DB_PATH = priorPath;
    await rm(directory, { recursive: true, force: true });
  });

  const meta = await request("GET", "/api/national/meta", "", { "accept-encoding": "gzip, br" });
  assert.equal(meta.status, 200);
  assert.equal(meta.headers["Content-Encoding"], "gzip");
  const info = JSON.parse(gunzipSync(meta.raw).toString("utf8"));
  assert.equal(info.venues, 7);
  assert.equal(info.statuses.find((status) => status.code === "verified").count, 1);

  const tile = await request("GET", `/api/national/tile/5/8/5?v=${info.version}&status=verified,unchecked`);
  assert.equal(tile.status, 200);
  assert.match(tile.headers["Cache-Control"], /immutable/);
  const data = JSON.parse(tile.body);
  assert.equal(data.v, info.version);
  assert.equal(data.c.filter((_, k) => k % 5 === 2).reduce((a, b) => a + b, 0) + data.p.length / 4, 2);
  assert.match((await request("GET", "/api/national/tile/5/8/5?v=old")).headers["Cache-Control"], /no-cache/);
  assert.equal((await request("GET", "/api/national/tile/5/99/5")).status, 400);

  const list = JSON.parse((await request("GET", "/api/national/list?region=12&limit=2")).body);
  assert.equal(list.total, 4);
  assert.equal(list.items.length, 2);
  const venue = JSON.parse((await request("GET", `/api/national/venue/${list.items[0].i}?v=${info.version}`)).body);
  assert.equal(venue.region_name, "Lazio");
  assert.equal((await request("GET", `/api/national/venue/0?v=stale`)).status, 409);
  assert.equal((await request("GET", "/api/national/locate?name=Roma&prov=RM")).status, 200);

  const csv = await request("GET", "/api/national/export.csv?status=verified");
  assert.match(csv.headers["Content-Disposition"], /attachment; filename="venues-.*-1\.csv"/);
  assert.match(csv.body, /Da Mario/);
});

test("the old pages redirect to the map", async () => {
  for (const path of ["/", "/index.html", "/review.html"]) {
    const response = await request("GET", path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.Location, "/map.html");
  }
  assert.equal((await request("GET", "/api/scans")).status, 404);
  assert.equal((await request("POST", "/api/scan", "{}")).status, 404);
});

test("a review from the venue card publishes the decision and updates the map", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "national-review-"));
  const db = join(directory, "national.sqlite");
  const prior = [process.env.NATIONAL_DB_PATH, process.env.NATIONAL_REVIEW_DB_PATH];
  process.env.NATIONAL_DB_PATH = db;
  process.env.NATIONAL_REVIEW_DB_PATH = join(directory, "missing-review.sqlite");
  leadFixtureStore(db);
  writeMapSnapshot(db);
  t.after(async () => {
    for (const [name, value] of [["NATIONAL_DB_PATH", prior[0]], ["NATIONAL_REVIEW_DB_PATH", prior[1]]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const info = JSON.parse((await request("GET", "/api/national/meta")).body);
  const list = JSON.parse((await request("GET", "/api/national/list?status=unresolved")).body);
  assert.equal(list.total, 1);
  const i = list.items[0].i;
  const detail = JSON.parse((await request("GET", `/api/national/review/${i}?v=${info.version}`)).body);
  assert.equal(detail.venue_id, "venue:amb");
  assert.deepEqual(detail.candidates.map((item) => item.domain), ["amb.example"]);
  assert.equal(detail.assessments[0].state, "ambiguous");
  assert.equal(detail.llm, null);
  assert.equal((await request("GET", `/api/national/review/${i}?v=stale`)).status, 409);

  const decision = (overrides) => JSON.stringify({ venue_id: "venue:amb", candidate_domain: "amb.example",
    decision: "approve", website_url: "https://amb.example/", evidence_urls: ["https://amb.example/contatti"],
    reviewer: "tester", ...overrides });
  assert.equal((await request("POST", "/api/national/review", "not-json")).status, 400);
  const invented = await request("POST", "/api/national/review", decision({ candidate_domain: "invented.example" }));
  assert.equal(invented.status, 400);
  assert.match(JSON.parse(invented.body).error, /not a stored candidate/);
  assert.equal((await request("POST", "/api/national/review", decision({ method: "official_registry" }))).status, 400);

  const approved = await request("POST", "/api/national/review", decision());
  assert.equal(approved.status, 200);
  assert.equal(JSON.parse(approved.body).status, "verified");

  // The snapshot is rebuilt in a worker; the venue turns verified once it lands.
  let meta = info;
  for (let attempt = 0; attempt < 100 && meta.version === info.version; attempt++) {
    await delay(50);
    meta = JSON.parse((await request("GET", "/api/national/meta")).body);
  }
  assert.notEqual(meta.version, info.version, "the map snapshot was rebuilt");
  assert.equal(meta.statuses.find((status) => status.code === "verified").count, 2);
  assert.equal(meta.statuses.find((status) => status.code === "unresolved").count, 0);
  const after = JSON.parse((await request("GET", `/api/national/review/${i}`)).body);
  assert.equal(after.attestations[0].reviewer, "tester");

  process.env.NATIONAL_DB_PATH = join(directory, "missing.sqlite");
  assert.equal((await request("POST", "/api/national/review", decision())).status, 503);
});

function request(method, url, body = "", headers = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = { host: "localhost", ...headers };
    const response = { status: 0, headers: {}, body: "", raw: Buffer.alloc(0) };
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        response.status = status;
        response.headers = headers || {};
        this.headersSent = true;
      },
      end(chunk = "") {
        response.raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        response.body += response.raw.toString("utf8");
        resolve(response);
      },
    };
    handle(req, res).catch(reject);
  });
}
