import { cacheGet, cacheSet } from "./cache.mjs";

export async function get(url, opts = {}) {
  const cached = await cacheGet(`get:${url}`);
  if (cached !== null) return cached;

  const { timeout = 30_000, headers = {} } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });

    const body = await res.text();
    const result = { ok: res.ok, status: res.status, body };
    if (res.ok) await cacheSet(`get:${url}`, result);
    return result;
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, status: 0, body: "" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getRendered(url, opts = {}) {
  const { timeout = 25_000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });

    const body = await res.text();
    return { ok: res.ok, body };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, body: "" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}