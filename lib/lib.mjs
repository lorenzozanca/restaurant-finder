import { cacheGet, cacheSet } from "./cache.mjs";

export async function get(url, opts = {}) {
  const { timeout = 30_000, headers = {}, maxBytes = 512_000 } = opts;
  const cached = await cacheGet(`get:v2:${maxBytes}:${url}`);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") || "";
    const binary = contentType.startsWith("image/") || contentType.includes("application/pdf");
    if (binary) await res.body?.cancel().catch(() => {});
    const { body, truncated, bytesRead } = binary
      ? { body: "", truncated: false, bytesRead: 0 }
      : await readBoundedText(res, maxBytes);
    const result = {
      ok: res.ok,
      status: res.status,
      body,
      final_url: res.url || url,
      content_type: contentType,
      content_length: numericHeader(res.headers.get("content-length")),
      last_modified: res.headers.get("last-modified") || undefined,
      body_truncated: truncated,
      body_bytes_read: bytesRead,
    };
    if (res.ok) await cacheSet(`get:v2:${maxBytes}:${url}`, result);
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
  const { timeout = 25_000, maxBytes = 512_000 } = opts;
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

    const { body, truncated, bytesRead } = await readBoundedText(res, maxBytes);
    return {
      ok: res.ok,
      status: res.status,
      body,
      final_url: res.url || url,
      content_type: res.headers.get("content-type") || "",
      content_length: numericHeader(res.headers.get("content-length")),
      last_modified: res.headers.get("last-modified") || undefined,
      body_truncated: truncated,
      body_bytes_read: bytesRead,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, body: "" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, maxBytes) {
  const limit = Math.max(0, Number(maxBytes) || 0);
  if (!response.body?.getReader) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    return {
      body: new TextDecoder().decode(bytes.subarray(0, limit)),
      truncated: bytes.length > limit,
      bytesRead: Math.min(bytes.length, limit),
    };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytesRead = 0;
  let truncated = false;
  while (bytesRead < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = limit - bytesRead;
    chunks.push(value.subarray(0, remaining));
    bytesRead += Math.min(value.length, remaining);
    if (value.length > remaining) { truncated = true; break; }
  }
  if (bytesRead >= limit) {
    const { done } = await reader.read();
    truncated ||= !done;
  }
  if (truncated) await reader.cancel().catch(() => {});
  const joined = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return { body: new TextDecoder().decode(joined), truncated, bytesRead };
}

function numericHeader(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
