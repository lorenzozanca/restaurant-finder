import test from "node:test";
import assert from "node:assert/strict";
import { get } from "./lib.mjs";

test("get bounds text bodies and records response metadata", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalCacheDir = process.env.CACHE_DIR;
  process.env.CACHE_DIR = "/tmp/restaurant-finder-phase-6-cache";
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalCacheDir === undefined) delete process.env.CACHE_DIR;
    else process.env.CACHE_DIR = originalCacheDir;
  });
  globalThis.fetch = async () => new Response("abcdefghij", {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "10", "last-modified": "Wed, 26 Aug 2026 10:00:00 GMT" },
  });
  const result = await get("https://bounded-text-phase-6.test/", { maxBytes: 5 });
  assert.equal(result.body, "abcde");
  assert.equal(result.body_bytes_read, 5);
  assert.equal(result.body_truncated, true);
  assert.equal(result.content_length, 10);
  assert.equal(result.last_modified, "Wed, 26 Aug 2026 10:00:00 GMT");
});

test("get does not load PDF or image bodies into text memory", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalCacheDir = process.env.CACHE_DIR;
  process.env.CACHE_DIR = "/tmp/restaurant-finder-phase-6-cache";
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalCacheDir === undefined) delete process.env.CACHE_DIR;
    else process.env.CACHE_DIR = originalCacheDir;
  });
  let bodyRead = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      bodyRead = true;
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "application/pdf", "content-length": "3000000" } });
  const result = await get("https://bounded-pdf-phase-6.test/menu.pdf", { maxBytes: 64_000 });
  assert.equal(result.body, "");
  assert.equal(result.body_bytes_read, 0);
  assert.equal(result.content_length, 3_000_000);
  assert.equal(bodyRead, false);
});
