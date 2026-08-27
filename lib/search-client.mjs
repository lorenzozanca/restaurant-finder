import { createHash } from "node:crypto";
import { classifySearchAttempt, countRelevantSearchResults } from "./search-health.mjs";

const PURPOSES = new Set(["official_site", "broad_discovery", "domain_constrained", "resource_site", "general"]);

export function createSearchRequest(input) {
  if (!input || typeof input !== "object") throw new TypeError("search request must be an object");
  const query = String(input.query || "").trim();
  if (!query) throw new TypeError("search request query is required");
  const purpose = input.purpose || "general";
  if (!PURPOSES.has(purpose)) throw new TypeError(`unsupported search purpose: ${purpose}`);
  const request = {
    query,
    limit: Math.max(1, Number(input.limit) || 10),
    purpose,
    locale: input.locale || "it-IT",
    country: input.country || "IT",
    location: input.location || {},
    identity: input.identity || {},
    required_domain: input.required_domain || null,
  };
  request.request_id = input.request_id || stableRequestId(request);
  return request;
}

export function createSearchClient({ providers = [], now = () => Date.now() } = {}) {
  return {
    async search(input) {
      const request = createSearchRequest(input);
      const attempts = [];
      let lastResults = [];
      for (const provider of providers) {
        const started = now();
        let raw;
        try {
          raw = await provider.search(request);
        } catch (error) {
          raw = failureFromError(provider.name, error);
        }
        const rawAttempts = Array.isArray(raw?.provider_attempts) && raw.provider_attempts.length
          ? raw.provider_attempts : [raw];
        const results = Array.isArray(raw?.results) ? raw.results : [];
        lastResults = results;
        const expanded = rawAttempts.map((item) => normalizeAttempt(
          item, provider.name, Math.max(0, now() - started), request,
        ));
        attempts.push(...expanded.map(withoutResults));
        const attempt = expanded.at(-1);
        const outcome = classifySearchAttempt(request, attempt);
        if (outcome === "relevant") return response(request, attempt.provider, outcome, attempts, results);
        if (outcome === "empty") return response(request, attempt.provider, outcome, attempts, []);
      }
      const last = attempts.at(-1);
      return response(request, last?.provider || null, outcomeFromAttempts(attempts), attempts,
        last?.transport_ok && last?.parse_ok ? lastResults : []);
    },
  };
}

export function responseFromAttempt(input, rawAttempt, cache = { status: "miss", stored: false }) {
  const request = createSearchRequest(input);
  const results = Array.isArray(rawAttempt.results) ? rawAttempt.results : [];
  const attempt = {
    provider: rawAttempt.provider || "unknown",
    http_status: rawAttempt.http_status ?? null,
    transport_ok: rawAttempt.transport_ok === true,
    parse_ok: rawAttempt.parse_ok === true,
    raw_count: rawAttempt.raw_count ?? results.length,
    relevant_count: 0,
    duration_ms: rawAttempt.duration_ms ?? 0,
    rate_headers: rawAttempt.rate_headers || {},
    reason: rawAttempt.reason || null,
    results,
  };
  const outcome = classifySearchAttempt(request, attempt);
  attempt.relevant_count = countRelevantSearchResults(request, attempt);
  attempt.reason = attempt.reason || reasonFor(outcome);
  return { ...response(request, attempt.provider, outcome, [withoutResults(attempt)], results), cache };
}

function response(request, provider, outcome, attempts, results) {
  return {
    request_id: request.request_id,
    purpose: request.purpose,
    query: request.query,
    provider,
    outcome,
    attempts,
    cache: { status: "miss", stored: false, ttl_seconds: null },
    results,
  };
}

function stableRequestId(request) {
  return createHash("sha256").update(JSON.stringify({
    query: request.query.replace(/\s+/g, " ").toLowerCase(), limit: request.limit,
    purpose: request.purpose, locale: request.locale, country: request.country,
    location: request.location, identity: request.identity, required_domain: request.required_domain,
  })).digest("hex").slice(0, 20);
}

function failureFromError(provider, error) {
  const timeout = error?.name === "AbortError" || error?.code === "ETIMEDOUT" || error?.killed;
  return {
    provider: provider || "unknown", http_status: null, transport_ok: false, parse_ok: false,
    results: [], reason: timeout ? "timeout" : "transport_error",
  };
}

function outcomeFromAttempts(attempts) {
  if (attempts.at(-1)?.reason === "budget_exhausted") return "budget_exhausted";
  if (attempts.some((item) => item.http_status === 429)) return "rate_limited";
  if (attempts.some((item) => item.transport_ok && item.parse_ok && item.raw_count > 0)) return "irrelevant";
  return attempts.some((item) => item.transport_ok && item.parse_ok) ? "empty" : "provider_failed";
}

function reasonFor(outcome) {
  return ({ relevant: "query_fidelity_passed", irrelevant: "query_fidelity_failed",
    empty: "empty_result_set", rate_limited: "rate_limited", provider_failed: "provider_failed" })[outcome] || outcome;
}

function withoutResults({ results, ...attempt }) { return attempt; }

function normalizeAttempt(raw, fallbackProvider, measuredDuration, request) {
  const item = raw && typeof raw === "object" ? raw : {};
  const results = Array.isArray(item.results) ? item.results : [];
  const attempt = {
    provider: item.provider || fallbackProvider || "unknown",
    http_status: item.http_status ?? null,
    transport_ok: item.transport_ok === true,
    parse_ok: item.parse_ok === true,
    raw_count: item.raw_count ?? results.length,
    relevant_count: 0,
    duration_ms: item.duration_ms ?? measuredDuration,
    rate_headers: item.rate_headers || {},
    reason: item.reason || null,
    results,
  };
  const outcome = classifySearchAttempt(request, attempt);
  attempt.relevant_count = countRelevantSearchResults(request, attempt);
  attempt.reason = attempt.reason || reasonFor(outcome);
  return attempt;
}
