const DEFAULT_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export function createBraveWebApiProvider(options = {}) {
  const apiKey = options.apiKey || process.env.BRAVE_SEARCH_API_KEY;
  const fetchFn = options.fetch || globalThis.fetch;
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  return {
    name: "brave_web_api",
    version: "v1",
    endpointVersion: `web-search-v1:${endpoint}`,
    async search(request) {
      if (!apiKey) {
        return failure("missing_api_key");
      }
      const url = new URL(endpoint);
      url.searchParams.set("q", request.query);
      url.searchParams.set("count", String(Math.min(20, request.limit)));
      url.searchParams.set("country", request.country || "IT");
      url.searchParams.set("search_lang", String(request.locale || "it-IT").split("-")[0]);
      const started = Date.now();
      let response;
      try {
        response = await fetchFn(url, {
          headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
      } catch (error) {
        const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
        return { ...failure(timeout ? "timeout" : "transport_error"), duration_ms: Date.now() - started };
      }
      const rateHeaders = pickRateHeaders(response.headers);
      if (!response.ok) {
        return {
          ...failure(response.status === 429 ? "rate_limited" : "http_error"),
          http_status: response.status, transport_ok: response.status === 429,
          duration_ms: Date.now() - started, rate_headers: rateHeaders,
        };
      }
      let body;
      try {
        body = await response.json();
      } catch {
        return { ...failure("parser_error"), http_status: response.status, transport_ok: true,
          duration_ms: Date.now() - started, rate_headers: rateHeaders };
      }
      const raw = Array.isArray(body?.web?.results) ? body.web.results : [];
      const results = raw.slice(0, request.limit).map((item) => ({
        title: item.title || "", url: item.url || "", snippet: item.description || "",
        search_engine: "brave_web_api",
      })).filter((item) => /^https?:\/\//.test(item.url));
      return {
        provider: "brave_web_api", http_status: response.status, transport_ok: true,
        parse_ok: true, raw_count: raw.length, duration_ms: Date.now() - started,
        rate_headers: rateHeaders, results,
      };
    },
  };
}

function failure(reason) {
  return { provider: "brave_web_api", http_status: null, transport_ok: false,
    parse_ok: false, raw_count: 0, rate_headers: {}, results: [], reason };
}

function pickRateHeaders(headers) {
  const result = {};
  for (const key of ["x-ratelimit-limit", "x-ratelimit-policy", "x-ratelimit-remaining",
    "x-ratelimit-reset", "retry-after"]) {
    const value = headers?.get?.(key);
    if (value !== null && value !== undefined) result[key] = value;
  }
  return result;
}
