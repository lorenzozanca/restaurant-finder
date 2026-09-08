import { locationDisplay, normalizeLocationContext } from "./location-context.mjs";

const DEFAULT_SEARCH_BUDGET = 1;
const DEFAULT_CRAWL_BUDGET = 3;
const MAX_SEARCH_BUDGET = 3;

export async function resolveOfficialSite({
  restaurant,
  location: locationValue,
  search,
  crawl,
  classifyWebsite,
  scoreWebsite,
  scoreSearchCandidate,
  canonicalUrl,
  budget = {},
  attestedWebsites = [],
}) {
  const location = normalizeLocationContext(locationValue);
  const limits = normalizeBudget(budget);
  const state = {
    status: "resolving",
    stop_reason: "",
    search_attempts: [],
    crawl_attempts: [],
    candidate_decisions: [],
    accepted_candidate: null,
    accepted_crawl: null,
    budget: limits,
  };
  const crawled = new Set();

  const tryCandidate = async (candidate, origin, searchRank) => {
    if (state.crawl_attempts.length >= limits.crawls) return false;
    const key = canonicalUrl(candidate.url);
    if (!key || crawled.has(key) || classifyWebsite(candidate.url) !== "official") return false;
    crawled.add(key);
    let crawlResult;
    try {
      crawlResult = await crawl(candidate.url);
    } catch (error) {
      crawlResult = { status: "failed", final_url: candidate.url, request_count: 1,
        resources: [], site_facts: {}, error: error?.message || "crawl_failed" };
    }
    const decision = scoreWebsite({
      ...candidate,
      crawl: crawlResult,
      known: origin === "source_provided",
    }, restaurant, location);
    const publicDecision = {
      url: decision.url || candidate.url,
      requested_url: candidate.url,
      outcome: decision.outcome,
      score: decision.score,
      confidence: decision.confidence,
      scores: decision.scores,
      reasons: decision.reasons,
      origin,
      search_rank: searchRank,
    };
    state.crawl_attempts.push({
      requested_url: candidate.url,
      final_url: crawlResult?.final_url || candidate.url,
      outcome: decision.outcome,
      origin,
      search_rank: searchRank,
      request_count: nonNegativeInteger(crawlResult?.request_count),
      cache_hit: crawlResult?.cache_hit === true,
    });
    state.candidate_decisions.push(publicDecision);
    if (decision.outcome !== "accepted") return false;
    state.status = "accepted";
    state.stop_reason = "official_site_accepted";
    state.accepted_candidate = { ...candidate, ...decision, origin };
    state.accepted_crawl = crawlResult;
    return true;
  };

  // Venue-scoped ownership attestations are the only trust root that can
  // publish. When one exists, its attested website is crawled before the
  // source-provided website and before any search — including when the source
  // record carries no usable website of its own (missing, social, or
  // directory hosts fail closed in tryCandidate). With no attestations this
  // loop is a no-op and behavior is unchanged.
  for (const attestedUrl of unique(attestedWebsites.map(clean))) {
    if (await tryCandidate({ url: attestedUrl }, "attested_ownership", null)) return finalize(state);
  }

  if (restaurant.website && classifyWebsite(restaurant.website) === "official") {
    if (await tryCandidate({ url: restaurant.website }, "source_provided", null)) return finalize(state);
  }

  const queries = buildOfficialSiteQueries(restaurant, location);
  for (const querySpec of queries) {
    if (state.search_attempts.length >= limits.searches
        || state.crawl_attempts.length >= limits.crawls) break;
    let rawResults = [];
    let searchResponse = null;
    let searchError = "";
    try {
      searchResponse = await search(querySpec.query, 8);
      rawResults = Array.isArray(searchResponse)
        ? searchResponse : searchResponse?.outcome === "relevant" && Array.isArray(searchResponse.results)
          ? searchResponse.results : [];
    } catch (error) { searchError = error?.message || "search_failed"; }
    state.search_attempts.push({
      kind: "official_site_identity",
      reason: querySpec.reason,
      query: querySpec.query,
      result_count: rawResults.length,
      outcome: Array.isArray(searchResponse)
        ? (rawResults.length ? "relevant" : "empty")
        : searchResponse?.outcome || "provider_failed",
      request_id: searchResponse?.request_id,
      provider: searchResponse?.provider,
      attempts: Array.isArray(searchResponse?.attempts) ? searchResponse.attempts : [],
      cache: searchResponse?.cache,
      error: searchError || undefined,
    });
    if (!Array.isArray(searchResponse) && searchResponse?.outcome === "provider_failed") {
      state.status = "provider_unavailable";
      state.stop_reason = "search_provider_unavailable";
      return finalize(state);
    }

    const candidates = rankSearchCandidates(rawResults, restaurant, location, {
      classifyWebsite, scoreWebsite, scoreSearchCandidate, canonicalUrl, crawled,
    });
    for (const candidate of candidates) {
      if (state.crawl_attempts.length >= limits.crawls) break;
      if (await tryCandidate(candidate, "web_search", candidate.search_rank)) return finalize(state);
    }
  }

  state.status = "budget_exhausted";
  state.stop_reason = exhaustedReason(state, limits);
  return finalize(state);
}

export function buildOfficialSiteQueries(restaurant, locationValue) {
  const location = normalizeLocationContext(locationValue);
  const municipality = location.municipality;
  const postcode = location.postcodes?.[0] || restaurant.postcode
    || restaurant.address_components?.postcode || restaurant.address_components?.postal_code || "";
  const aliases = unique([restaurant.name, ...(restaurant.aliases || [])].map(clean));
  const street = clean(restaurant.address_components?.street
    || String(restaurant.address || "").split(",")[0]);
  const phone = normalizePhone(restaurant.phone);
  const generic = meaningfulNameTokens(aliases[0]).length === 0;
  const queries = [];

  if (phone) queries.push({ reason: "exact_phone", query: `"${phone}" "${municipality}"` });
  for (const alias of aliases) {
    queries.push({ reason: "alias_location_identity",
      query: [`"${alias}"`, `"${municipality}"`, postcode ? `"${postcode}"` : ""]
        .filter(Boolean).join(" ") });
  }
  if (street && (generic || aliases.length === 1)) {
    queries.push({ reason: "street_location_identity",
      query: `"${aliases[0]}" "${street}" "${municipality}"` });
  }
  const core = coreName(aliases[0]);
  if (core && core !== normalizeText(aliases[0])) {
    queries.push({ reason: "core_name_fallback", query: `${core} ${locationDisplay(location)} ristorante` });
  }
  return dedupeQueries(queries);
}

function rankSearchCandidates(results, restaurant, location, dependencies) {
  const seen = new Set();
  return results.map((result, index) => ({ ...result, search_rank: index + 1 }))
    .filter((result) => {
      const key = dependencies.canonicalUrl(result.url);
      if (!key || seen.has(key) || dependencies.crawled.has(key)) return false;
      seen.add(key);
      return dependencies.classifyWebsite(result.url) === "official";
    })
    .map((result) => {
      const website = dependencies.scoreWebsite(result, restaurant, location);
      const searchScore = dependencies.scoreSearchCandidate(result, restaurant, location);
      return { ...result, _resolver_score: Math.max(website.score || 0, searchScore.score || 0),
        _resolver_outcome: website.outcome };
    })
    .filter((result) => result._resolver_outcome !== "rejected"
      || result._resolver_score >= 35)
    .sort((left, right) => outcomeRank(right._resolver_outcome) - outcomeRank(left._resolver_outcome)
      || right._resolver_score - left._resolver_score
      || left.search_rank - right.search_rank);
}

function normalizeBudget(value) {
  const requestedSearches = boundedInteger(value.searches, DEFAULT_SEARCH_BUDGET, 0, MAX_SEARCH_BUDGET);
  if (requestedSearches === 3 && !clean(value.budget_escalation_reason)) {
    throw new Error("a third official-site search requires budget_escalation_reason");
  }
  return {
    searches: requestedSearches,
    crawls: boundedInteger(value.crawls, DEFAULT_CRAWL_BUDGET, 0, DEFAULT_CRAWL_BUDGET),
    budget_escalation_reason: requestedSearches === 3 ? clean(value.budget_escalation_reason) : undefined,
  };
}
function exhaustedReason(state, limits) {
  if (state.crawl_attempts.length >= limits.crawls) return "crawl_budget_exhausted";
  if (limits.searches === 0 && state.search_attempts.length === 0) {
    return state.candidate_decisions.length
      ? "crawl_only_candidates_not_accepted" : "crawl_only_no_candidate";
  }
  if (state.search_attempts.length >= limits.searches) return "search_budget_exhausted";
  return "candidate_budget_exhausted";
}
function finalize(state) {
  const bestCandidateDecision = state.candidate_decisions.toSorted((left, right) =>
    outcomeRank(right.outcome) - outcomeRank(left.outcome) || right.score - left.score)[0] || null;
  return { ...state, best_candidate_decision: bestCandidateDecision,
    search_requests: state.search_attempts.length,
    crawl_candidates: state.crawl_attempts.length,
    crawl_requests: state.crawl_attempts.reduce((sum, item) => sum + item.request_count, 0),
    crawl_cache_hits: state.crawl_attempts.filter((item) => item.cache_hit).length };
}
function outcomeRank(value) { return value === "accepted" ? 2 : value === "review" ? 1 : 0; }
function boundedInteger(value, fallback, minimum, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`resolver budget must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
function nonNegativeInteger(value) { return Number.isInteger(value) && value >= 0 ? value : 0; }
function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^39(?=\d{8,})/, "");
  return digits.length >= 7 ? digits : "";
}
function meaningfulNameTokens(value) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 3
    && !["al", "alla", "il", "la", "bar", "pub", "ristorante", "pizzeria"].includes(token));
}
function coreName(value) {
  return normalizeText(value).replace(/^(?:al|alla|il|la|bar|pub|ristorante|pizzeria|trattoria|osteria)\s+/, "");
}
function normalizeText(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function dedupeQueries(values) {
  const seen = new Set();
  return values.filter((item) => {
    const key = item.query.toLowerCase();
    if (!item.query || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function clean(value) { return String(value || "").trim(); }
