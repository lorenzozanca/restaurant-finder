import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Real JavaScript rendering for candidate pages whose plain fetch is thin, blocked,
// or rejected at TLS. Drives an installed Chrome over the DevTools protocol with
// Node's built-in WebSocket, so the crawler needs no browser npm dependency.

const DEFAULT_EXECUTABLES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findChromeExecutable(candidates = DEFAULT_EXECUTABLES) {
  return candidates.find((path) => existsSync(path)) || null;
}

export function createHeadlessRenderer(options = {}) {
  const executablePath = "executablePath" in options ? options.executablePath : findChromeExecutable();
  const concurrency = Math.max(1, Number(options.concurrency) || 2);
  const settleMs = options.settleMs ?? 6_000;
  let browserPromise = null;
  let active = 0;
  const waiting = [];

  async function browser() {
    if (!executablePath) throw new Error("headless_browser_unavailable");
    if (!browserPromise) {
      browserPromise = launchBrowser(executablePath, options.launchTimeout || 20_000);
      browserPromise.then((instance) => instance.onExit(() => { browserPromise = null; }),
        () => { browserPromise = null; });
    }
    return browserPromise;
  }

  async function slot() {
    if (active < concurrency) { active++; return; }
    await new Promise((resolve) => waiting.push(resolve));
  }
  function release() {
    const next = waiting.shift();
    if (next) next(); else active--;
  }

  async function render(url, requestOptions = {}) {
    const timeout = requestOptions.timeout || 20_000;
    const maxBytes = requestOptions.maxBytes || 512_000;
    await slot();
    try {
      const instance = await browser();
      return await renderPage(instance, url, { timeout, maxBytes, settleMs });
    } catch (error) {
      return { ok: false, status: 0, body: "", final_url: url, rendered: true,
        failure_reason: String(error?.message || "render_failed").slice(0, 80) };
    } finally {
      release();
    }
  }

  async function close() {
    const pending = browserPromise;
    browserPromise = null;
    if (!pending) return;
    try { await (await pending).close(); } catch {}
  }

  return { render, close, available: Boolean(executablePath) };
}

async function launchBrowser(executablePath, launchTimeout) {
  const userDataDir = await mkdtemp(join(tmpdir(), "restaurant-finder-chrome-"));
  const child = spawn(executablePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", "--disable-sync",
    "--mute-audio", "--blink-settings=imagesEnabled=false", "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const exitHandlers = [];
  let exited = false;
  child.on("exit", () => { exited = true; for (const handler of exitHandlers) handler(); });

  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("headless_browser_launch_timeout")), launchTimeout);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", () => { clearTimeout(timer); reject(new Error("headless_browser_exited")); });
  }).catch(async (error) => {
    child.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });
    throw error;
  });

  const connection = await connect(endpoint);
  return {
    connection,
    onExit(handler) { if (exited) handler(); else exitHandlers.push(handler); },
    async close() {
      try { await connection.send("Browser.close", {}, undefined, 5_000); } catch {}
      connection.close();
      if (!exited) child.kill("SIGKILL");
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let nextId = 1;
    const calls = new Map();
    const listeners = new Set();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, sessionId, timeout = 30_000) {
        const id = nextId++;
        return new Promise((resolveCall, rejectCall) => {
          const timer = setTimeout(() => {
            calls.delete(id);
            rejectCall(new Error(`cdp_timeout:${method}`));
          }, timeout);
          calls.set(id, { resolve: resolveCall, reject: rejectCall, timer });
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      close() { try { socket.close(); } catch {} },
    }));
    socket.addEventListener("error", () => reject(new Error("cdp_connect_failed")));
    socket.addEventListener("close", () => {
      for (const call of calls.values()) { clearTimeout(call.timer); call.reject(new Error("cdp_closed")); }
      calls.clear();
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const call = calls.get(message.id);
        if (!call) return;
        calls.delete(message.id);
        clearTimeout(call.timer);
        if (message.error) call.reject(new Error(`cdp_error:${message.error.message}`));
        else call.resolve(message.result);
        return;
      }
      for (const listener of listeners) listener(message);
    });
  });
}

async function renderPage({ connection }, url, { timeout, maxBytes, settleMs }) {
  const { targetId } = await connection.send("Target.createTarget", { url: "about:blank" });
  let removeListener = () => {};
  try {
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true });
    let documentResponse = null;
    let loaded;
    const loadFired = new Promise((resolve) => { loaded = resolve; });
    removeListener = connection.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Network.responseReceived" && message.params.type === "Document"
          && message.params.frameId === targetId) {
        documentResponse = message.params.response;
      }
      if (message.method === "Page.loadEventFired") loaded();
    });
    await connection.send("Network.enable", {}, sessionId);
    await connection.send("Page.enable", {}, sessionId);
    const deadline = Date.now() + timeout;
    const navigation = await connection.send("Page.navigate", { url }, sessionId, timeout);
    if (navigation.errorText) {
      return { ok: false, status: 0, body: "", final_url: url, rendered: true,
        failure_reason: navigation.errorText };
    }
    await Promise.race([loadFired, sleep(Math.max(0, deadline - Date.now()))]);
    await settleRenderedText(connection, sessionId, Math.min(deadline, Date.now() + settleMs));
    const { result } = await connection.send("Runtime.evaluate", {
      expression: "JSON.stringify({ href: location.href, html: document.documentElement.outerHTML })",
      returnByValue: true,
    }, sessionId, 10_000);
    const page = JSON.parse(result?.value || "{}");
    const status = documentResponse?.status || 0;
    const bytes = new TextEncoder().encode(page.html || "");
    return {
      ok: status >= 200 && status < 400,
      status,
      body: new TextDecoder().decode(bytes.subarray(0, maxBytes)),
      final_url: page.href || documentResponse?.url || url,
      content_type: headerValue(documentResponse?.headers, "content-type"),
      body_truncated: bytes.length > maxBytes,
      body_bytes_read: Math.min(bytes.length, maxBytes),
      rendered: true,
    };
  } finally {
    removeListener();
    try { await connection.send("Target.closeTarget", { targetId }, undefined, 5_000); } catch {}
  }
}

// Client-rendered sites (Wix, SPA builders) fill the page after the load event.
// Poll visible text and stop early once a substantial page stops growing.
async function settleRenderedText(connection, sessionId, until) {
  let previous = -1;
  while (Date.now() < until) {
    await sleep(Math.min(500, Math.max(0, until - Date.now())));
    let length = 0;
    try {
      const { result } = await connection.send("Runtime.evaluate", {
        expression: "document.body ? document.body.innerText.length : 0", returnByValue: true,
      }, sessionId, 2_000);
      length = Number(result?.value) || 0;
    } catch { return; }
    if (length >= 500 && length === previous) return;
    previous = length;
  }
}

function headerValue(headers = {}, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name);
  return key ? String(headers[key]) : "";
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
