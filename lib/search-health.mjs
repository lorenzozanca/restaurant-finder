const OUTCOMES = new Set([
  "relevant", "irrelevant", "empty", "rate_limited", "provider_failed",
  "budget_exhausted",
]);

export function classifySearchAttempt(request, attempt) {
  if (attempt.reason === "budget_exhausted") return "budget_exhausted";
  if (attempt.http_status === 429) return "rate_limited";
  if (!attempt.transport_ok) {
    return "provider_failed";
  }
  if (!attempt.parse_ok) return "provider_failed";
  const results = Array.isArray(attempt.results) ? attempt.results : [];
  if (results.length === 0) return "empty";

  switch (request.purpose) {
    case "domain_constrained":
      return countRelevantSearchResults(request, attempt) > 0
        ? "relevant" : "irrelevant";
    case "official_site":
      return countRelevantSearchResults(request, attempt) > 0 ? "relevant" : "irrelevant";
    case "broad_discovery":
      return countRelevantSearchResults(request, attempt) > 0 ? "relevant" : "irrelevant";
    default:
      return "relevant";
  }
}

export function countRelevantSearchResults(request, attempt) {
  const results = Array.isArray(attempt.results) ? attempt.results : [];
  switch (request.purpose) {
    case "domain_constrained":
      return results.filter((result) => hostnameMatches(result.url, request.required_domain)).length;
    case "official_site":
      return results.filter((result) => targetedVenueResultRelevant(request, result)).length;
    case "broad_discovery":
      return results.filter((result) => broadDiscoveryResultRelevant(request, result)).length;
    default:
      return results.length;
  }
}

export function isSearchOutcome(value) {
  return OUTCOMES.has(value);
}

function targetedVenueResultRelevant(request, result) {
  const aliases = (request.identity?.aliases || []).map(normalize).filter(Boolean);
  const phone = normalizePhone(request.identity?.phone);
  const local = localSignals(request.location);
  const text = normalize(`${result.title || ""} ${result.snippet || ""} ${safeUrlText(result.url)}`);
  const identityMatch = aliases.some((alias) => text.includes(alias))
    || (phone && normalizePhone(text).includes(phone));
  return identityMatch && local.some((signal) => text.includes(signal));
}

function broadDiscoveryResultRelevant(request, result) {
  const local = localSignals(request.location);
  const text = normalize(`${result.title || ""} ${result.snippet || ""} ${safeUrlText(result.url)}`);
  return /ristorant|pizzer|trattori|osteria|menu|sushi|bar|pub|caffe/.test(text)
    && local.some((signal) => text.includes(signal));
}

function localSignals(location = {}) {
  return [location.municipality, location.postcode, ...(location.postcodes || []),
    location.province_code, location.province]
    .map(normalize).filter((value) => value && value.length > 1);
}

function hostnameMatches(value, requiredDomain) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    const required = String(requiredDomain || "").toLowerCase().replace(/^www\./, "");
    return required && (hostname === required || hostname.endsWith(`.${required}`));
  } catch {
    return false;
  }
}

function safeUrlText(value) {
  try { return decodeURIComponent(new URL(value).href); } catch { return String(value || ""); }
}

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").replace(/^39(?=\d{8,})/, "");
}
