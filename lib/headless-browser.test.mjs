import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createHeadlessRenderer, findChromeExecutable } from "./headless-browser.mjs";

const chrome = findChromeExecutable();

test("renderer reports unavailability without a browser", async () => {
  const renderer = createHeadlessRenderer({ executablePath: "" });
  assert.equal(renderer.available, false);
  const result = await renderer.render("http://127.0.0.1:9/");
  assert.equal(result.ok, false);
  assert.equal(result.failure_reason, "headless_browser_unavailable");
});

test("headless Chrome returns client-rendered text, status, and final URL",
  { skip: chrome ? false : "no Chrome executable installed" }, async (t) => {
    const server = createServer((request, response) => {
      if (request.url === "/old") {
        response.writeHead(301, { location: "/app" });
        response.end();
      } else if (request.url === "/app") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<html><body><div id="app"></div><script>
          setTimeout(() => { document.getElementById("app").textContent =
            "Trattoria Rendered Via Roma 1 " + "menu ".repeat(120); }, 300);
        </script></body></html>`);
      } else if (request.url === "/dead") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<meta http-equiv="refresh" content="0;URL=http://127.0.0.1:9/">');
      } else {
        response.writeHead(404, { "content-type": "text/html" });
        response.end("<p>missing</p>");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const renderer = createHeadlessRenderer({ executablePath: chrome, settleMs: 3_000 });
    t.after(async () => { await renderer.close(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;

    const page = await renderer.render(`${base}/old`, { timeout: 15_000 });
    assert.equal(page.ok, true);
    assert.equal(page.status, 200);
    assert.equal(page.final_url, `${base}/app`);
    assert.match(page.body, /Trattoria Rendered Via Roma 1/);

    const missing = await renderer.render(`${base}/missing`, { timeout: 15_000 });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);

    // A meta refresh to a dead site ends on Chrome's error page, not on an http URL.
    const dead = await renderer.render(`${base}/dead`, { timeout: 15_000 });
    assert.equal(dead.ok, false);
    assert.equal(dead.failure_reason, "client_redirect_failed");
    assert.equal(dead.final_url, `${base}/dead`);
  });
