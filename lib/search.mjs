import { cacheGet, cacheSet } from "./cache.mjs";
import { createSearchClient, createSearchRequest, responseFromAttempt } from "./search-client.mjs";
import { getDefaultSearchProviders } from "../sources/search/default-providers.mjs";

const CACHE_VERSION = "search-response-v2";
const FIDELITY_SCORER_VERSION = "query-fidelity-v1";
const RELEVANT_TTL_MS = 24 * 60 * 60 * 1_000;
const TRANSIENT_TTL_MS = 5 * 1_000;

export async function search(query, limit = 10, options = {}) {
  const response = await searchDetailed(compatibilityRequest(query, limit, options));
  if (options.throwOnError && ["provider_failed", "rate_limited"].includes(response.outcome)) {
    throw new Error(`search ${response.outcome} for: ${query}`);
  }
  return response.results;
}

export async function searchDetailed(input, dependencies = {}) {
  const request = createSearchRequest(input);
  const { cacheGetFn = cacheGet, cacheSetFn = cacheSet } = dependencies;
  const providers = dependencies.providers || (dependencies.provider ? [dependencies.provider]
    : dependencies.client ? [] : getDefaultSearchProviders(dependencies.providerOptions));
  const key = createSearchCacheKey(request, providers, dependencies.client);
  const cacheOptions = { cacheDir: dependencies.cacheDir || process.env.SEARCH_CACHE_DIR };
  const cached = await cacheGetFn(key, cacheOptions);
  if (cached !== null) {
    if (cached?.request_id && Array.isArray(cached.attempts)) {
      return { ...cached, cache: { ...cached.cache, status: "hit", stored: true } };
    }
    const results = Array.isArray(cached) ? cached : [];
    const provider = results[0]?.search_engine || "unknown";
    return responseFromAttempt(request, {
      provider, http_status: 200, transport_ok: true, parse_ok: true,
      raw_count: results.length, duration_ms: 0, results, reason: "legacy_cache_replay",
    }, { status: "hit", stored: true, ttl_seconds: 86_400 });
  }

  const client = dependencies.client || createSearchClient({ providers });
  const response = await client.search(request);
  response.cache.ttl_seconds = response.outcome === "relevant"
    ? RELEVANT_TTL_MS / 1_000 : TRANSIENT_TTL_MS / 1_000;
  if (response.outcome === "relevant") {
    response.cache.stored = true;
    await cacheSetFn(key, response, { ...cacheOptions, ttlMs: RELEVANT_TTL_MS });
  } else if (["rate_limited", "provider_failed", "budget_exhausted"].includes(response.outcome)) {
    response.cache.stored = true;
    await cacheSetFn(key, response, { ...cacheOptions, ttlMs: TRANSIENT_TTL_MS });
  }
  return response;
}

export function createSearchCacheKey(input, providers = [], client = null) {
  const request = createSearchRequest(input);
  const providerNamespace = providers.length
    ? providers.map((provider) => ({ name: provider.name || "unknown",
      endpoint_version: provider.endpointVersion || provider.version || "1" }))
    : [{ name: client?.name || "injected_client", endpoint_version: client?.version || "1" }];
  return `${CACHE_VERSION}:${stableJson({
    providers: providerNamespace,
    query: request.query.replace(/\s+/g, " ").trim().toLowerCase(),
    locale: request.locale,
    country: request.country,
    limit: request.limit,
    purpose: request.purpose,
    location: request.location,
    identity: request.identity,
    required_domain: request.required_domain,
    fidelity_scorer_version: FIDELITY_SCORER_VERSION,
  })}`;
}

function compatibilityRequest(query, limit, options) {
  const domain = String(query).match(/^site:([^\s]+)/i)?.[1] || null;
  const quoted = [...String(query).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const broadTown = String(query).match(/(?:ristoranti|pizzerie|trattorie)\s+(.+?)\s+(?:sito|menu)/i)?.[1];
  const purpose = options.purpose || (domain ? "domain_constrained"
    : quoted.length >= 2 ? "official_site"
      : broadTown ? "broad_discovery" : "general");
  return {
    query, limit, purpose, required_domain: options.required_domain || domain,
    location: options.location || { municipality: quoted[1] || broadTown || "" },
    identity: options.identity || { aliases: quoted[0] ? [quoted[0]] : [] },
    locale: options.locale, country: options.country,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
