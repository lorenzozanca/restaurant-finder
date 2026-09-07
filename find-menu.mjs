import { get, getRendered } from "./lib/lib.mjs";
import { searchDetailed } from "./lib/search.mjs";
import { normalizeLocationContext } from "./lib/location-context.mjs";
import { resolveOfficialSite } from "./lib/official-site-resolver.mjs";
import { evaluatePublisherOwnership } from "./lib/publisher-ownership.mjs";

const DIRECTORY_DOMAINS = [
  "paginegialle.it", "paginebianche.it",
  "tripadvisor.it", "tripadvisor.com", "restaurantguru.it", "restaurantguru.com",
  "sluurpy.it", "pagina-inizio.com", "oraridiapertura24.it", "wheree.com",
  "outdooractive.com", "virgilio.it", "tuttocitta.it", "foodracers.com",
  "piatti.menu",
  "mapquest.com", "annunciefree.com", "trip.com", "pizzeriasaronno.it",
  "eccellenzeitaliane.com", "elenchitelefonici.it", "tellows.it",
  "gastroranking.it", "openalfa.it", "mymenuweb.com", "wanderlog.com",
  "zenhotels.com", "impresaitalia.info", "trovabar.sky.it",
  "tutti-gli-orari.it", "reteimprese.it", "2night.it", "misterimprese.it",
  "tuttoindirizzi.it", "distanzechilometriche.net", "gustoegusti.it",
  "places2.com", "guidotommasi.it", "oggitreviso.it", "telefono-societa.it",
  "cronachedigusto.it", "touringclub.it", "lacaseranevegal.it", "enrosadira.it",
  // Session 10 live-pilot regressions: third-party directories, review sites,
  // tourism/editorial publishers, and business-listing hosts are evidence
  // sources, never the venue's official website.
  "corriere.it", "mindtrip.ai", "trivago.it", "informazione-aziende.it",
  "wanderme.net", "telefono.click", "rivieraconero.com", "prontoatutto.it",
  "roma03.net", "nuovaopinione.it", "iltaccodibacco.it", "top10posti.it",
  "happycow.net", "hotel-trapani.com",
  // Fresh Session 10 regressions: menu mirrors and business directories.
  "giallozafferano.it", "grubbio.com", "opendi.it", "res-menu.net",
  "mycia.it", "mapstr.com",
];
const DIRECTORY_DOMAIN_MARKERS = ["tripadvisor.", "restaurantguru."];
const SOCIAL_DOMAINS = ["facebook.com", "instagram.com", "youtube.com", "tiktok.com"];
const HARD_BLOCKED_DOMAINS = [
  "wikipedia.org", "wiktionary.org", "translate.google.", "treccani.it",
  "thefork.it", "thefork.com",
  "xvideos.com", "xhamster.com", "youjizz.com", "tubesafari.com", "monstercockland.com",
];
const GENERIC_NAME_TOKENS = new Set([
  "al", "alla", "alle", "allo", "ai", "a", "da", "dal", "dalla", "de", "del",
  "della", "di", "il", "la", "le", "lo", "l", "in", "the", "ristorante",
  "ristoranti", "pizzeria", "pizza", "trattoria", "osteria", "bar", "pub",
  "cafe", "caffe", "hotel", "locanda", "agriturismo", "sushi",
]);
const FOOD_TERMS = [
  "ristorante", "pizzeria", "trattoria", "osteria", "cucina", "ristorazione",
  "pizza", "sushi", "paninoteca", "birreria", "enoteca", "gastronomia",
];
const MENU_TERMS = [
  "menu", "listino", "food", "antipasti", "primi", "secondi", "dolci",
  "alla carta", "carta del ristorante", "carta dei piatti",
];
const DRINK_TERMS = ["drink", "vino", "vini", "wine", "bevande", "birre", "cocktail", "bar list"];
const ORDER_TERMS = [
  "ordina", "ordine", "ordering", "asporto", "consegna", "domicilio",
  "delivery", "takeaway", "take-away",
];
const BOOKING_TERMS = ["prenota", "prenotazione", "booking", "reservation", "riserva tavolo"];
const SPECIALTY_TERMS = [
  "carne", "pesce", "brace", "griglia", "specialita", "degustazione", "cantina",
];
const BOILERPLATE_TERMS = [
  "privacy", "cookie", "login", "sign-in", "signin", "account", "terms",
  "condizioni", "imprint", "sitemap", "withdrawal", "recesso", "email-protection",
  "wp-admin", "wp-login", "feed", "weather", "webcam", "helpcenter",
];
const IMAGE_JUNK_TERMS = [
  "logo", "icon", "favicon", "sprite", "avatar", "flag", "placeholder",
  "cookie", "tracking", "pixel", "loading", "spinner", "badge",
];
const EDITORIAL_RESOURCE_PATHS = ["/blog/", "/news/", "/taccuino/", "/viaggi-di-vino/"];
const LODGING_TERMS = ["room", "rooms", "camera", "camere", "suite", "bedroom", "alloggio"];
const BUSINESS_SCHEMA_TERMS = ["restaurant", "foodestablishment", "barorpub", "cafeorcoffeeshop", "localbusiness"];
const EDITORIAL_SCHEMA_TERMS = ["article", "newsarticle", "blogposting", "review", "itemlist"];
const NON_RESTAURANT_TERMS = [
  "istituto", "scuola", "universita", "comune", "municipio", "museo", "parrocchia",
  "immobiliare", "automobili", "officina", "farmacia",
];
const ITALIAN_PLACE_TOKENS = new Set([
  "ancona", "bari", "bergamo", "bologna", "bolzano", "brescia", "cagliari", "catania",
  "como", "firenze", "genova", "lecce", "livorno", "mantova", "milano", "modena",
  "monza", "napoli", "novara", "oderzo", "padova", "palermo", "parma", "perugia",
  "pisa", "ravenna", "rimini", "roma", "sauris", "siena", "taormina", "torino",
  "trento", "treviso", "trieste", "udine", "varese", "venezia", "verona", "vicenza",
]);
const PROVINCE_PLACE = {
  BA: "bari", BO: "bologna", CA: "cagliari", CT: "catania", FI: "firenze",
  GE: "genova", MI: "milano", NA: "napoli", PA: "palermo", PD: "padova",
  PR: "parma", RM: "roma", TO: "torino", TV: "treviso", TS: "trieste",
  UD: "udine", VE: "venezia", VR: "verona", VI: "vicenza",
};
const MAX_RESOURCES = 6;
const MAX_SECONDARY = 1;
const MAX_IMAGES = 2;
const MAX_RESOURCE_VALIDATIONS = 8;
const MAX_SITEMAP_REQUESTS = 2;
const MAX_HTML_BODY_BYTES = 512_000;
const MAX_SITEMAP_BODY_BYTES = 256_000;
const MAX_BINARY_BODY_BYTES = 64_000;
const SEASONAL_TERMS = ["estate", "inverno", "primavera", "autunno", "natale", "pasqua", "stagionale", "seasonal"];
const PUBLISHABLE_RESOURCE_ROLES = new Set(["menu", "drinks", "order", "booking", "specialty", "menu_image"]);
const websiteCrawlCache = new Map();

export async function findMenuSources(restaurant, location, options = {}) {
  location = normalizeLocationContext(location);
  const detailedSearch = (query, limit, searchOptions = {}) => searchDetailed({
    query,
    limit,
    purpose: searchOptions.purpose || "official_site",
    required_domain: searchOptions.required_domain,
    location,
    identity: { aliases: [restaurant.name, ...(restaurant.aliases || [])].filter(Boolean) },
  });
  const dependencies = {
    search: options.search || detailedSearch,
    get: options.get || get,
    getRendered: options.getRendered || getRendered,
  };
  const resolverSearches = options.resolverBudget?.searches ?? 1;
  const resourcePolicy = {
    referenceDate: options.referenceDate || new Date(),
    maxValidations: options.resourceBudget?.validations ?? MAX_RESOURCE_VALIDATIONS,
    maxSitemapRequests: options.resourceBudget?.sitemaps ?? MAX_SITEMAP_REQUESTS,
    // Phase 0 crawl-only baseline ($0): resolver searches:0 must not spend a
    // search request elsewhere. The domain-restricted resource site: search is
    // therefore off by default when the resolver budget is zero; callers may
    // still opt back in with an explicit resourceBudget.siteSearch:true.
    allowSiteSearch: options.resourceBudget?.siteSearch !== undefined
      ? options.resourceBudget.siteSearch !== false
      : resolverSearches !== 0,
  };
  const crawlCache = options.crawlCache || websiteCrawlCache;
  const originalWebsite = restaurant.website || "";
  const originalKind = classifyWebsite(originalWebsite);
  const attestedWebsites = (Array.isArray(restaurant.publisher_ownership)
    ? restaurant.publisher_ownership : [])
    .filter((attestation) => attestation?.status === "verified" && attestation.website_url)
    .map((attestation) => attestation.website_url);
  const resolver = await resolveOfficialSite({
    restaurant, location,
    search: dependencies.search,
    crawl: (url) => huntOnWebsite(url, dependencies, crawlCache),
    classifyWebsite,
    scoreWebsite: scoreOfficialWebsite,
    scoreSearchCandidate,
    canonicalUrl,
    budget: options.resolverBudget,
    attestedWebsites,
  });
  return buildResult({ restaurant, originalWebsite, originalKind, resolver, dependencies, location, resourcePolicy });
}

async function buildResult({
  restaurant, originalWebsite, originalKind, resolver, dependencies, location, resourcePolicy,
}) {
  const checkedAt = new Date().toISOString();
  const officialCandidate = resolver.accepted_candidate;
  const officialWebsite = officialCandidate?.url || "";
  let siteResources = resolver.accepted_crawl?.status === "succeeded"
    ? resolver.accepted_crawl.resources : [];
  let resourceDiscoveryRequests = 0;
  let resourceSiteSearchRequests = 0;
  let resourceSearchAttempts = [];
  if (officialWebsite && siteResources.length === 0) {
    const sitemap = await trySitemaps(
      officialWebsite, dependencies.get, resolver.accepted_crawl?.site_facts?.sitemap_urls,
      resourcePolicy.maxSitemapRequests,
    );
    siteResources = sitemap.resources;
    resourceDiscoveryRequests = sitemap.request_count;
  }
  if (officialWebsite && siteResources.length === 0 && resourcePolicy.allowSiteSearch) {
    const searched = await searchOfficialResources(officialWebsite, dependencies.search);
    siteResources = searched.resources;
    resourceSiteSearchRequests = searched.request_count;
    resourceSearchAttempts = searched.search_attempt ? [searched.search_attempt] : [];
  }
  const validation = officialWebsite
    ? await validateResourceCandidates(
        siteResources, restaurant, location, officialWebsite, dependencies, resourcePolicy,
      )
    : { accepted: [], decisions: [], request_count: 0, pre_cap_dropped: [] };
  const ranked = rankAndLimitResources(validation.accepted);
  const resources = ranked.selected
    .map((resource) => ({ ...resource, checked_at: resource.checked_at || checkedAt }));
  const resourceStageMetrics = buildResourceStageMetrics({
    candidates: siteResources,
    decisions: validation.decisions,
    preCapDropped: validation.pre_cap_dropped,
    postCapDropped: ranked.dropped,
  });
  const directoryUrl = originalWebsite && originalKind !== "official" ? originalWebsite : undefined;
  const bestDecision = officialCandidate || resolver.best_candidate_decision;
  const websiteSource = officialCandidate?.origin === "source_provided"
    ? restaurant.provenance?.website?.[0]?.source || "source_record"
    : "web_search";
  return {
    website: officialWebsite || undefined,
    website_kind: officialWebsite ? "official" : undefined,
    website_confidence: officialCandidate?.confidence,
    website_decision: officialCandidate
      ? publicWebsiteDecision(officialCandidate)
      : bestDecision ? publicWebsiteDecision(bestDecision) : undefined,
    website_provenance: officialCandidate ? {
      source: officialCandidate.source || websiteSource,
      origin: officialCandidate.origin || "validated_search_result",
      source_url: officialCandidate.url,
      evidence: officialCandidate.reasons || ["known_website", "website_validation"],
      checked_at: checkedAt,
    } : undefined,
    directory_url: directoryUrl,
    resources,
    resource_decisions: validation.decisions.map((decision) => ({ ...decision, checked_at: checkedAt })),
    enrichment_run: {
      strategy: "website_first",
      resolver_status: resolver.status,
      resolver_stop_reason: resolver.stop_reason,
      resolver_budget: resolver.budget,
      crawl_requests: resolver.crawl_requests,
      crawl_cache_hits: resolver.crawl_cache_hits,
      crawl_attempts: resolver.crawl_attempts,
      resolver_candidate_decisions: resolver.candidate_decisions,
      search_requests: resolver.search_requests,
      search_fallback_reason: resolver.stop_reason,
      search_attempts: resolver.search_attempts,
      resource_discovery_requests: resourceDiscoveryRequests,
      resource_site_search_requests: resourceSiteSearchRequests,
      resource_search_attempts: resourceSearchAttempts,
      resource_validation_requests: validation.request_count,
      resource_stage_metrics: resourceStageMetrics,
    },
  };
}

async function huntOnWebsite(website, dependencies, crawlCache) {
  const key = crawlCacheKey(website);
  if (crawlCache.has(key)) {
    const cached = await crawlCache.get(key);
    return { ...cached, resources: [...cached.resources], cache_hit: true, request_count: 0 };
  }
  const pending = crawlWebsiteUncached(website, dependencies);
  crawlCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    crawlCache.delete(key);
    throw error;
  }
}

async function crawlWebsiteUncached(website, dependencies) {
  let html;
  let requestCount = 1;
  try {
    const res = await dependencies.get(website, { timeout: 8_000, maxBytes: MAX_HTML_BODY_BYTES });
    if (!res.ok) return {
      status: "failed", resources: [], cache_hit: false, request_count: requestCount,
      final_url: res.final_url || website, http_status: res.status || 0,
    };
    html = res.body;
    var responseFacts = res;
  } catch {
    return { status: "failed", resources: [], cache_hit: false, request_count: requestCount };
  }
  const textLen = stripTags(html).length;
  if (textLen < 200 || /enable\s?(js|javascript)/i.test(html)) {
    try {
      requestCount++;
      const rendered = await dependencies.getRendered(website, { timeout: 10_000, maxBytes: MAX_HTML_BODY_BYTES });
      if (rendered.ok && rendered.body && rendered.body.length > html.length + 100) {
        html = rendered.body;
        responseFacts = { ...responseFacts, ...rendered };
      }
    } catch {}
  }
  const resources = extractRelevantSiteResources(html, website);
  return {
    status: "succeeded",
    resources,
    cache_hit: false,
    request_count: requestCount,
    final_url: responseFacts?.final_url || website,
    http_status: responseFacts?.status || 200,
    content_type: responseFacts?.content_type || "",
    content_length: responseFacts?.content_length,
    last_modified: responseFacts?.last_modified,
    body_truncated: Boolean(responseFacts?.body_truncated),
    site_facts: extractWebsiteFacts(html, website),
  };
}

export function extractRelevantSiteResources(html, website) {
  const resources = [];
  const domain = extractDomain(website);
  const linkPattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html))) {
    const href = match[2];
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const resolved = resolveUrl(href, website);
    if (sameCanonicalUrl(resolved, website)) continue;
    const label = decodeEntities(stripTags(match[4])).trim();
    const imageText = [...match[4].matchAll(/\b(?:alt|title)\s*=\s*["']([^"']+)["']/gi)]
      .map((item) => item[1]).join(" ");
    const descriptor = normalizeText(`${resolved} ${label} ${imageText}`);
    if (hasAnyTerm(descriptor, BOILERPLATE_TERMS)) continue;
    const isPdf = /\.pdf(?:$|[?#])/i.test(resolved);
    const isImage = /\.(?:png|jpe?g|gif|webp|avif)(?:$|[?#])/i.test(resolved);
    const hasMenu = hasAnyTerm(descriptor, MENU_TERMS);
    const hasDrinks = hasAnyTerm(descriptor, DRINK_TERMS);
    const hasOrder = isOrderingUrl(resolved) || hasAnyTerm(descriptor, ORDER_TERMS);
    const hasBooking = hasAnyTerm(descriptor, BOOKING_TERMS);
    const hasSpecialty = hasAnyTerm(descriptor, SPECIALTY_TERMS);
    const sameDomain = extractDomain(resolved) === domain;
    const externalTransactionalPage = !sameDomain && (hasOrder || hasBooking)
      && classifyWebsite(resolved) === "official";
    if (!sameDomain && !externalTransactionalPage) continue;
    if (!isPdf && !hasMenu && !hasDrinks && !hasOrder && !hasBooking && !hasSpecialty) continue;
    if (hasOrder && hasAnyTerm(descriptor, LODGING_TERMS) && !hasMenu && !hasSpecialty) continue;
    resources.push({
      type: isPdf ? "pdf" : isImage ? "image" : "webpage",
      role: isImage ? "menu_image" : hasOrder ? "order" : hasBooking ? "booking" : hasDrinks ? "drinks" : hasMenu || isPdf ? "menu" : "specialty",
      url: resolved,
      found_via: "official_website",
      confidence: isImage ? "low" : isPdf || hasMenu || hasOrder ? "high" : "medium",
      label: label.slice(0, 100) || undefined,
      source_url: website,
      evidence: [
        sameDomain ? "same_official_domain" : "linked_from_official_site",
        isPdf ? "pdf_url" : hasOrder ? "order_anchor" : hasDrinks ? "drinks_anchor" : hasMenu ? "menu_anchor" : "specialty_anchor",
      ],
    });
  }

  const imagePattern = /<img\b([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  let imageCount = 0;
  while (imageCount < MAX_IMAGES && (match = imagePattern.exec(html))) {
    const src = match[2];
    if (!src || src.startsWith("data:")) continue;
    const resolved = resolveUrl(src, website);
    if (extractDomain(resolved) !== domain) continue;
    const attrs = `${match[1]} ${match[3]}`;
    const alt = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    const title = attrs.match(/\btitle\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    const nearby = stripTags(html.slice(Math.max(0, match.index - 180), imagePattern.lastIndex + 180));
    const descriptor = normalizeText(`${resolved} ${alt} ${title}`);
    const context = normalizeText(nearby);
    if (hasAnyTerm(descriptor, IMAGE_JUNK_TERMS)) continue;
    const strongImageSignal = hasAnyTerm(descriptor, MENU_TERMS);
    const contextualSignal = hasAnyTerm(context, MENU_TERMS)
      && hasAnyTerm(`${descriptor} ${context}`, [...FOOD_TERMS, ...SPECIALTY_TERMS]);
    if (!strongImageSignal && !contextualSignal) continue;
    resources.push({
      type: "image",
      role: "menu_image",
      url: resolved,
      found_via: "official_website_context",
      confidence: strongImageSignal ? "medium" : "low",
      label: (alt || title).slice(0, 100) || undefined,
      source_url: website,
      evidence: ["same_official_domain", strongImageSignal ? "menu_image_metadata" : "menu_image_context"],
    });
    imageCount++;
  }
  return dedupe(resources);
}

function extractWebsiteFacts(html, website) {
  const canonical = String(html || "").match(
    /<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']|<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["']/i
  );
  const structuredTypes = [];
  for (const match of String(html || "").matchAll(/["']@type["']\s*:\s*["']([^"']+)["']/gi)) {
    structuredTypes.push(match[1]);
  }
  const phones = [...String(html || "").matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)]
    .map((match) => match[1]);
  const sitemapUrls = [];
  for (const match of String(html || "").matchAll(/<link\b([^>]*?)>/gi)) {
    const tag = match[1];
    if (!/\brel\s*=\s*["'][^"']*sitemap[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) sitemapUrls.push(resolveUrl(href, website));
  }
  return {
    text: stripTags(html).slice(0, 30_000),
    canonical_url: resolveUrl(canonical?.[1] || canonical?.[2] || "", website),
    structured_types: [...new Set(structuredTypes)].slice(0, 10),
    phones: phones.join(" "),
    sitemap_urls: [...new Set(sitemapUrls)].filter((url) => extractDomain(url) === extractDomain(website)),
  };
}

export function scoreSearchCandidate(result, restaurant, location, officialDomain = "") {
  const url = String(result.url || "");
  const domain = extractDomain(url);
  if (!domain || HARD_BLOCKED_DOMAINS.some((item) => domain.includes(item))) return rejectedScore("blocked_domain");
  const aliases = venueAliases(restaurant);
  const haystack = normalizeText(`${result.title || ""} ${result.snippet || ""} ${decodeURIComponentSafe(url)}`);
  const matchedAlias = bestAlias(aliases, haystack);
  const name = normalizeText(matchedAlias);
  const nameTokens = meaningfulNameTokens(matchedAlias);
  const matchedTokens = nameTokens.filter((token) => haystack.includes(token));
  const tokenRatio = nameTokens.length ? matchedTokens.length / nameTokens.length : 0;
  const exactName = name.length >= 4 && haystack.includes(name);
  const hasLocation = meaningfulLocationTokens(location).some((token) => haystack.includes(token));
  const hasFood = hasAnyTerm(haystack, FOOD_TERMS);
  const hasMenu = hasAnyTerm(haystack, [...MENU_TERMS, ...ORDER_TERMS, ...SPECIALTY_TERMS]);
  const sameDomain = Boolean(officialDomain && domain === officialDomain);
  const domainText = normalizeText(domain.replace(/\.[a-z]{2,}$/i, "").replace(/\./g, " "));
  const domainNameMatch = nameTokens.some((token) => domainText.includes(token));
  const isPdf = /\.pdf(?:$|[?#])/i.test(url);
  const genericName = nameTokens.length === 0;
  let score = 0;
  const reasons = [];
  if (sameDomain) { score += 55; reasons.push("official_domain"); }
  if (exactName) { score += 34; reasons.push("exact_name"); }
  if (tokenRatio > 0) { score += Math.round(tokenRatio * 28); reasons.push("name_tokens"); }
  if (hasLocation) { score += 16; reasons.push("location"); }
  if (domainNameMatch) { score += 18; reasons.push("branded_domain"); }
  if (hasFood) { score += 8; reasons.push("restaurant_context"); }
  if (hasMenu) { score += 10; reasons.push("menu_context"); }
  if (isPdf) { score += 6; reasons.push("pdf"); }
  if (genericName) score -= 30;
  if (result.search_engine === "bing" && !sameDomain) {
    score -= 8;
    reasons.push("fallback_engine");
  }
  const hasIdentity = exactName || tokenRatio >= 0.5 || domainNameMatch || sameDomain;
  const hasRelevantContext = hasLocation || hasFood || hasMenu || isPdf;
  const accepted = hasIdentity && (sameDomain
    ? score >= 45
    : hasRelevantContext && score >= 52);
  const confidence = score >= 82 ? "high" : score >= 62 ? "medium" : "low";
  const officialCandidate = accepted && classifyWebsite(url) === "official" && hasFood
    && ((exactName && (hasLocation || domainNameMatch)) || (domainNameMatch && hasIdentity));
  const websiteDecision = classifyWebsite(url) === "official"
    ? scoreOfficialWebsite(result, restaurant, location)
    : null;
  return {
    score,
    confidence,
    reasons,
    accepted,
    officialCandidate: officialCandidate && websiteDecision?.outcome === "accepted",
    outcome: accepted ? "accepted" : score >= 40 ? "review" : "rejected",
    scores: websiteDecision?.scores || {
      identity: Math.min(100, Math.round((exactName ? 55 : 0) + tokenRatio * 35)),
      geography: hasLocation ? 70 : 0,
      officialness: 0,
    },
    official_outcome: websiteDecision?.outcome || "rejected",
  };
}

export function scoreOfficialWebsite(candidate, restaurant, location) {
  const requestedUrl = String(candidate.url || "");
  const crawl = candidate.crawl || {};
  const finalUrl = String(crawl.final_url || requestedUrl);
  const url = finalUrl || requestedUrl;
  const domain = extractDomain(url);
  if (!domain || classifyWebsite(url) !== "official") {
    return officialDecision(requestedUrl, url, "rejected", 0, 0, 0, ["non_official_domain"]);
  }

  const facts = crawl.site_facts || {};
  const metadata = normalizeText(`${candidate.title || ""} ${candidate.snippet || ""}`);
  const pageText = normalizeText(facts.text || "");
  const haystack = `${metadata} ${pageText}`.trim();
  const aliases = venueAliases(restaurant);
  const matchedAlias = bestAlias(aliases, haystack);
  const name = normalizeText(matchedAlias);
  const nameTokens = meaningfulNameTokens(matchedAlias);
  const matchedTokens = nameTokens.filter((token) => haystack.includes(token));
  const tokenRatio = nameTokens.length ? matchedTokens.length / nameTokens.length : 0;
  const exactName = name.length >= 4 && haystack.includes(name);
  const domainText = normalizeText(domain.replace(/\.[a-z]{2,}$/i, "").replace(/\./g, " "));
  const brandedDomain = nameTokens.some((token) => domainText.includes(token));
  const domainTokenRatio = nameTokens.length
    ? nameTokens.filter((token) => domainText.includes(token)).length / nameTokens.length : 0;
  const phoneMatch = normalizedPhones(restaurant.phone).some((phone) =>
    normalizedPhones(`${facts.phones || ""} ${haystack}`).some((found) => phone.endsWith(found) || found.endsWith(phone))
  );
  const streetTokens = meaningfulAddressTokens(restaurant.address);
  const streetMatches = streetTokens.filter((token) => haystack.includes(token));
  const addressMatch = streetTokens.length >= 2 && streetMatches.length >= Math.min(2, streetTokens.length);

  const requestedPlaces = requestedPlaceTokens(location);
  const targetPlace = requestedPlaces[0] || "";
  const hasTargetPlace = Boolean(targetPlace && haystack.includes(targetPlace));
  const foreignPlaces = [...ITALIAN_PLACE_TOKENS]
    .filter((place) => !requestedPlaces.includes(place) && haystack.includes(place));
  const geographyContradiction = !hasTargetPlace && foreignPlaces.length > 0;
  const schemaTypes = (facts.structured_types || []).map(normalizeText);
  const structuredBusiness = schemaTypes.some((type) => BUSINESS_SCHEMA_TERMS.includes(type));
  const structuredEditorial = schemaTypes.some((type) => EDITORIAL_SCHEMA_TERMS.includes(type));
  const hasFood = hasAnyTerm(haystack, FOOD_TERMS);
  const nonRestaurantContext = hasAnyTerm(haystack, NON_RESTAURANT_TERMS) && !hasFood && !structuredBusiness;
  const usefulResources = Number(crawl.resources?.length || 0) > 0;
  const canonicalDomain = extractDomain(facts.canonical_url || "");
  const canonicalSameDomain = Boolean(canonicalDomain && canonicalDomain === domain);
  const canonicalConflict = Boolean(canonicalDomain && canonicalDomain !== domain);
  const requestedDomain = extractDomain(requestedUrl);
  const redirectDomainChanged = Boolean(requestedDomain && requestedDomain !== domain);
  const publisherOwnership = evaluatePublisherOwnership(url, restaurant);

  let identity = 0;
  if (exactName) identity += 55;
  identity += Math.round(tokenRatio * 35);
  if (brandedDomain) identity += 20;
  if (phoneMatch) identity += 30;
  if (addressMatch) identity += 20;
  const structuredSourceWebsite = candidate.known
    && (restaurant.sources || []).some((source) => ["overture_places", "nominatim"].includes(source))
    && Boolean(restaurant.phone || restaurant.address)
    && domainTokenRatio === 1
    && !domain.endsWith("oldwildwest.com");
  if (structuredSourceWebsite) identity += 40;
  identity = Math.min(100, identity);

  let geography = 0;
  if (hasTargetPlace) geography += 70;
  if (addressMatch) geography += 25;
  if (phoneMatch) geography += 10;
  geography = Math.min(100, geography);

  let officialness = 20;
  if (brandedDomain) officialness += 25;
  if (hasFood) officialness += 20;
  if (structuredBusiness) officialness += 25;
  if (phoneMatch || addressMatch) officialness += 15;
  if (canonicalSameDomain) officialness += 10;
  if (usefulResources) officialness += 15;
  if (candidate.known) officialness += 15;
  if (redirectDomainChanged) officialness -= 15;
  officialness = Math.max(0, Math.min(100, officialness));

  const reasons = [];
  if (candidate.known) reasons.push("source_provided_website");
  if (exactName) reasons.push("exact_name");
  else if (tokenRatio >= 0.5) reasons.push("name_tokens");
  if (brandedDomain) reasons.push("branded_domain");
  if (hasTargetPlace) reasons.push("municipality_match");
  if (phoneMatch) reasons.push("phone_match");
  if (addressMatch) reasons.push("address_match");
  if (hasFood) reasons.push("restaurant_context");
  if (structuredBusiness) reasons.push("structured_business_data");
  if (structuredEditorial) reasons.push("structured_editorial_data");
  if (canonicalSameDomain) reasons.push("same_domain_canonical");
  if (usefulResources) reasons.push("useful_first_party_resource");
  if (redirectDomainChanged) reasons.push("redirect_domain_changed");
  if (canonicalConflict) reasons.push("cross_domain_canonical");
  if (nonRestaurantContext) reasons.push("non_restaurant_context");
  if (geographyContradiction) reasons.push("geography_contradiction", ...foreignPlaces.map((place) => `mentions_${place}`));
  reasons.push(publisherOwnership.status === "verified"
    ? "publisher_ownership_verified" : "publisher_ownership_unverified");

  const structuredKnownIdentity = candidate.known && exactName && brandedDomain
    && hasTargetPlace && usefulResources;
  const hasOfficialContext = hasFood || structuredBusiness || phoneMatch || addressMatch
    || structuredKnownIdentity || structuredSourceWebsite;
  let outcome = "rejected";
  if (!canonicalConflict && !geographyContradiction && !nonRestaurantContext && !structuredEditorial
      && identity >= 55 && officialness >= 45
      && publisherOwnership.status === "verified"
      && hasOfficialContext && (geography >= 50 || candidate.known)) {
    outcome = "accepted";
  } else if (!canonicalConflict && !geographyContradiction && !nonRestaurantContext && !structuredEditorial
      && identity >= 35 && officialness >= 30) {
    outcome = "review";
  }
  if (redirectDomainChanged && outcome === "accepted" && !(exactName && hasTargetPlace)) outcome = "review";

  return officialDecision(requestedUrl, url, outcome, identity, geography, officialness, reasons,
    publisherOwnership);
}

function officialDecision(requestedUrl, finalUrl, outcome, identity, geography, officialness, reasons,
  publisherOwnership = { status: "unverified", method: null, reason: "not_evaluated" }) {
  const score = Math.round(identity * 0.4 + geography * 0.25 + officialness * 0.35);
  const confidence = outcome === "accepted" && score >= 78 ? "high"
    : outcome === "accepted" ? "medium" : "low";
  return {
    url: finalUrl || requestedUrl,
    requested_url: requestedUrl || undefined,
    final_url: finalUrl || undefined,
    outcome,
    accepted: outcome === "accepted",
    officialCandidate: outcome === "accepted",
    score,
    confidence,
    scores: { identity, geography, officialness },
    reasons: [...new Set(reasons)],
    publisher_ownership: publisherOwnership,
  };
}

function publicWebsiteDecision(candidate) {
  return {
    status: candidate.outcome,
    scores: candidate.scores,
    confidence: candidate.confidence,
    requested_url: candidate.requested_url,
    final_url: candidate.final_url,
    evidence: candidate.reasons || [],
    publisher_ownership: candidate.publisher_ownership,
  };
}

export function classifyWebsite(url) {
  const domain = extractDomain(url);
  if (!domain) return "none";
  if (HARD_BLOCKED_DOMAINS.some((item) => domain.includes(item))) return "blocked";
  if (DIRECTORY_DOMAIN_MARKERS.some((item) => domain.includes(item))) return "directory";
  if (DIRECTORY_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) return "directory";
  if (SOCIAL_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) return "social";
  return "official";
}

function toResource(result, scored, role) {
  return {
    type: /\.pdf(?:$|[?#])/i.test(result.url) ? "pdf" : "webpage", role,
    url: result.url, found_via: "web_search_validated", confidence: scored.confidence,
    score: scored.score, label: String(result.title || "").slice(0, 100) || undefined,
    evidence: scored.reasons,
    source_url: result.url,
  };
}

async function validateResourceCandidates(candidates, restaurant, location, officialWebsite, dependencies, policy) {
  const decisions = [];
  let requestCount = 0;
  const preselected = preselectResourceCandidates(candidates, policy.maxValidations);
  for (const candidate of preselected.selected) {
    let response;
    try {
      requestCount++;
      response = await dependencies.get(candidate.url, {
        timeout: 8_000,
        maxBytes: candidate.type === "pdf" || candidate.type === "image"
          ? MAX_BINARY_BODY_BYTES : MAX_HTML_BODY_BYTES,
      });
    } catch {
      response = { ok: false, status: 0, body: "", final_url: candidate.url, content_type: "" };
    }
    decisions.push(validateResourceCandidate(
      candidate, restaurant, location, officialWebsite, response, { referenceDate: policy.referenceDate },
    ));
  }
  return {
    accepted: decisions.filter((item) => item.status === "accepted").map((item) => item.resource),
    decisions: decisions.map(publicResourceDecision),
    request_count: requestCount,
    pre_cap_dropped: preselected.dropped,
  };
}

export function validateResourceCandidate(candidate, restaurant, location, officialWebsite, response = {}, options = {}) {
  const requestedUrl = String(candidate.url || "");
  const finalUrl = String(response.final_url || requestedUrl);
  const statusCode = Number(response.status || (response.ok ? 200 : 0));
  const contentType = String(response.content_type || "").toLowerCase();
  const body = String(response.body || "");
  const bodyText = normalizeText(stripTags(body).slice(0, 30_000));
  const anchorUrlDescriptor = normalizeText(`${finalUrl} ${candidate.label || ""} ${candidate.nearby_text || ""}`);
  const pageDescriptor = extractResourcePageDescriptor(body, finalUrl);
  const officialDomain = extractDomain(officialWebsite);
  const finalDomain = extractDomain(finalUrl);
  const sameDomain = Boolean(officialDomain && finalDomain === officialDomain);
  const finalKind = classifyWebsite(finalUrl);
  const facts = extractWebsiteFacts(body, finalUrl);
  const canonicalDomain = extractDomain(facts.canonical_url || "");
  const crossDomainCanonical = Boolean(canonicalDomain && canonicalDomain !== finalDomain);
  const isPdf = contentType.includes("application/pdf") || /\.pdf(?:$|[?#])/i.test(finalUrl);
  const isImage = contentType.startsWith("image/") || /\.(?:png|jpe?g|webp|avif)(?:$|[?#])/i.test(finalUrl);
  const htmlLike = !contentType || contentType.includes("html") || contentType.includes("xhtml");
  const roleDecision = classifyResourceRole(anchorUrlDescriptor, pageDescriptor, candidate.role, {
    isPdf, isImage, isOrderingSurface: isOrderingUrl(finalUrl),
  });
  const role = roleDecision.role;
  const requestedPlaces = requestedPlaceTokens(location);
  const targetPlace = requestedPlaces[0] || "";
  const hasTargetPlace = Boolean(targetPlace && bodyText.includes(targetPlace));
  const foreignPlaces = [...ITALIAN_PLACE_TOKENS]
    .filter((place) => !requestedPlaces.includes(place) && bodyText.includes(place));
  const geographyContradiction = Boolean(bodyText && !hasTargetPlace && foreignPlaces.length);
  const identityText = `${anchorUrlDescriptor} ${pageDescriptor}`;
  const matchedAlias = bestAlias(venueAliases(restaurant), identityText);
  const name = normalizeText(matchedAlias);
  const nameTokens = meaningfulNameTokens(matchedAlias);
  const exactName = name.length >= 4 && identityText.includes(name);
  const tokenMatches = nameTokens.filter((token) => identityText.includes(token));
  const venueIdentity = exactName || (nameTokens.length > 0 && tokenMatches.length / nameTokens.length >= 0.5);
  const roleDescriptor = roleDecision.source === "page" ? pageDescriptor : anchorUrlDescriptor;
  const roleEvidence = roleDecision.source === "ordering_surface" ? true
    : role === "menu_image" ? isImage
    : role === "order" ? hasAnyTerm(roleDescriptor, ORDER_TERMS)
    : role === "booking" ? hasAnyTerm(roleDescriptor, BOOKING_TERMS)
    : role === "drinks" ? hasAnyTerm(roleDescriptor, DRINK_TERMS)
    : role === "specialty" ? hasAnyTerm(roleDescriptor, SPECIALTY_TERMS)
    : role === "menu" ? isPdf || hasAnyTerm(roleDescriptor, MENU_TERMS)
    : false;
  const boilerplate = hasAnyTerm(anchorUrlDescriptor, BOILERPLATE_TERMS) && !roleEvidence;
  const irrelevantImage = isImage && hasAnyTerm(anchorUrlDescriptor, IMAGE_JUNK_TERMS);
  const editorialResource = EDITORIAL_RESOURCE_PATHS.some((path) => {
    try { return new URL(finalUrl).pathname.toLowerCase().includes(path); } catch { return false; }
  });
  const officialPath = pathOf(officialWebsite);
  const finalPath = pathOf(finalUrl);
  const branchScoped = officialPath !== "/";
  const withinOfficialBranch = finalPath === officialPath
    || (officialPath.endsWith("/") && finalPath.startsWith(officialPath));
  const branchIdentityConflict = branchScoped && !withinOfficialBranch && !venueIdentity;
  const freshness = decideResourceFreshness({
    candidate, finalUrl, body, lastModified: response.last_modified,
    pdfMetadata: response.pdf_metadata,
    referenceDate: options.referenceDate || new Date(),
  });
  const reasons = [];
  if (statusCode >= 200 && statusCode < 400) reasons.push("reachable_status");
  if (sameDomain) reasons.push("same_official_domain");
  else if (finalDomain) reasons.push("redirected_external_domain");
  if (finalUrl !== requestedUrl) reasons.push("redirect_followed");
  if (contentType) reasons.push(isPdf ? "pdf_content_type" : isImage ? "image_content_type" : htmlLike ? "html_content_type" : "other_content_type");
  if (roleEvidence) reasons.push(`${role}_evidence`);
  reasons.push(`role_from_${roleDecision.source}`);
  if (venueIdentity) reasons.push("venue_identity");
  if (hasTargetPlace) reasons.push("municipality_match");
  if (crossDomainCanonical) reasons.push("cross_domain_canonical");
  if (geographyContradiction) reasons.push("geography_contradiction");
  if (boilerplate) reasons.push("boilerplate_resource");
  if (irrelevantImage) reasons.push("unrelated_image");
  if (editorialResource) reasons.push("editorial_resource");
  if (branchIdentityConflict) reasons.push("branch_identity_missing");
  reasons.push(...freshness.evidence);

  let outcome = "accepted";
  if (!requestedUrl || !finalDomain || ["blocked", "directory", "social"].includes(finalKind)
      || statusCode < 200 || statusCode >= 400 || crossDomainCanonical || geographyContradiction
      || boilerplate || irrelevantImage || freshness.status === "stale"
      || editorialResource || branchIdentityConflict
      || !PUBLISHABLE_RESOURCE_ROLES.has(role)) {
    outcome = "rejected";
  } else if (!roleEvidence || freshness.status === "review" || (!sameDomain && !venueIdentity)) {
    outcome = "review";
  }
  const confidence = outcome === "accepted" && sameDomain && roleEvidence ? "high"
    : outcome === "accepted" ? "medium" : "low";
  const resource = {
    ...candidate,
    url: finalUrl,
    type: isPdf ? "pdf" : isImage ? "image" : "webpage",
    role,
    confidence,
    resource_confidence: confidence,
    venue_confidence: venueIdentity || sameDomain ? "high" : "low",
    http_status: statusCode,
    content_type: contentType || undefined,
    content_length: response.content_length,
    last_modified: response.last_modified,
    final_url: finalUrl,
    freshness: freshness.status,
    freshness_signals: freshness.signals,
    body_truncated: Boolean(response.body_truncated),
    role_evidence: { source: roleDecision.source, anchor_url: anchorUrlDescriptor, page: pageDescriptor },
    evidence: [...new Set([...(candidate.evidence || []), ...reasons])],
  };
  return { status: outcome, requested_url: requestedUrl, final_url: finalUrl, role, confidence,
    freshness: freshness.status, evidence: resource.evidence, resource };
}

function pathOf(value) {
  try { return new URL(value).pathname.replace(/\/+$/, "") || "/"; } catch { return "/"; }
}

function publicResourceDecision(decision) {
  return {
    status: decision.status,
    role: decision.role,
    confidence: decision.confidence,
    requested_url: decision.requested_url,
    final_url: decision.final_url,
    http_status: decision.resource.http_status,
    content_type: decision.resource.content_type,
    content_length: decision.resource.content_length,
    last_modified: decision.resource.last_modified,
    freshness: decision.freshness,
    freshness_signals: decision.resource.freshness_signals,
    body_truncated: decision.resource.body_truncated,
    role_evidence: decision.resource.role_evidence,
    evidence: decision.evidence,
  };
}

function classifyResourceRole(anchorUrlDescriptor, pageDescriptor, fallback, {
  isPdf, isImage, isOrderingSurface,
}) {
  if (isImage) return { role: "menu_image", source: "anchor_url" };
  // A menu route on a merchant-controlled ordering host is still an ordering
  // interface. This keeps content menus distinct from transaction surfaces.
  if (isOrderingSurface) return { role: "order", source: "ordering_surface" };
  const strong = roleFromTerms(anchorUrlDescriptor, isPdf);
  if (strong) return { role: strong, source: "anchor_url" };
  if (fallback && PUBLISHABLE_RESOURCE_ROLES.has(fallback)) return { role: fallback, source: "candidate" };
  return { role: roleFromTerms(pageDescriptor, isPdf) || fallback || "venue_page", source: "page" };
}

function preferResourceVariants(resources) {
  const best = new Map();
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  for (const resource of resources) {
    const key = canonicalResourceUrl(resource.url);
    if (!key) continue;
    const current = best.get(key);
    const evidenceCount = resource.evidence?.length || 0;
    const currentEvidenceCount = current?.evidence?.length || 0;
    if (!current || (confidenceRank[resource.confidence] || 0) > (confidenceRank[current.confidence] || 0)
        || evidenceCount > currentEvidenceCount) best.set(key, resource);
  }
  return [...best.values()];
}

function preselectResourceCandidates(resources, limit = MAX_RESOURCE_VALIDATIONS) {
  const candidates = preferResourceVariants(resources).sort(compareResources);
  const selected = [];
  const selectedKeys = new Set();
  const roles = ["menu", "drinks", "order", "booking", "specialty", "menu_image"];
  for (const role of roles) {
    const candidate = candidates.find((item) => item.role === role && !selectedKeys.has(canonicalResourceUrl(item.url)));
    if (!candidate || selected.length >= limit) continue;
    selected.push(candidate);
    selectedKeys.add(canonicalResourceUrl(candidate.url));
  }
  for (const candidate of candidates) {
    const key = canonicalResourceUrl(candidate.url);
    if (selected.length >= limit) break;
    if (selectedKeys.has(key)) continue;
    if (candidate.type === "image" && selected.filter((item) => item.type === "image").length >= MAX_IMAGES) continue;
    selected.push(candidate);
    selectedKeys.add(key);
  }
  return { selected, dropped: candidates.filter((item) => !selectedKeys.has(canonicalResourceUrl(item.url))) };
}

function rankAndLimitResources(resources) {
  const sorted = dedupe(resources).sort(compareResources);
  const hasFirstPartyResource = resources.some((resource) =>
    String(resource.found_via || "").startsWith("official_")
  );
  const eligible = sorted.filter((resource) =>
    !(resource.role === "secondary" && hasFirstPartyResource));
  const chosen = new Set();
  for (const role of ["menu", "drinks", "order", "booking", "specialty", "menu_image", "secondary"]) {
    const candidate = eligible.find((item) => item.role === role);
    if (candidate && chosen.size < MAX_RESOURCES) chosen.add(candidate);
  }
  for (const resource of eligible) {
    if (chosen.size >= MAX_RESOURCES) break;
    if (resource.role === "secondary"
        && [...chosen].filter((item) => item.role === "secondary").length >= MAX_SECONDARY) continue;
    if (resource.type === "image"
        && [...chosen].filter((item) => item.type === "image").length >= MAX_IMAGES) continue;
    chosen.add(resource);
  }
  const selected = sorted.filter((item) => chosen.has(item));
  return { selected, dropped: sorted.filter((item) => !selected.includes(item)) };
}

async function trySitemaps(baseUrl, getFn, declared = [], maxRequests = MAX_SITEMAP_REQUESTS) {
  const origin = new URL(baseUrl).origin;
  const urls = [...new Set([
    ...(declared || []).filter((url) => extractDomain(url) === extractDomain(origin)),
    `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`,
  ])];
  let requestCount = 0;
  for (const url of urls) {
    if (requestCount >= maxRequests) break;
    requestCount++;
    let response;
    try { response = await getFn(url, { timeout: 6_000, maxBytes: MAX_SITEMAP_BODY_BYTES }); }
    catch { response = null; }
    if (!response?.ok) continue;
    const resources = [];
    const body = response.body;
    for (const match of body.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const url = decodeEntities(match[1]).trim();
      if (extractDomain(url) !== extractDomain(origin)) continue;
      const descriptor = normalizeText(url);
      if (!hasAnyTerm(descriptor, [...MENU_TERMS, ...DRINK_TERMS, ...ORDER_TERMS, ...BOOKING_TERMS, ...SPECIALTY_TERMS])) continue;
      resources.push({
        type: /\.pdf(?:$|[?#])/i.test(url) ? "pdf" : "webpage",
        role: hasAnyTerm(descriptor, ORDER_TERMS) ? "order"
          : hasAnyTerm(descriptor, BOOKING_TERMS) ? "booking"
          : hasAnyTerm(descriptor, DRINK_TERMS) ? "drinks"
          : hasAnyTerm(descriptor, SPECIALTY_TERMS) ? "specialty" : "menu",
        url, found_via: "official_sitemap", confidence: "medium",
        source_url: origin,
        evidence: ["same_official_domain", "sitemap_resource_term"],
      });
    }
    if (resources.length) {
      return { resources: dedupe(resources), request_count: requestCount };
    }
  }
  return { resources: [], request_count: requestCount };
}

async function searchOfficialResources(baseUrl, searchFn) {
  const domain = extractDomain(baseUrl);
  if (!domain) return { resources: [], request_count: 0 };
  const query = `site:${domain} (menu OR menù OR carta OR ordina OR asporto)`;
  let response;
  try { response = await searchFn(query, 10, { purpose: "resource_site", required_domain: domain }); }
  catch { response = []; }
  const results = Array.isArray(response) ? response : response?.results || [];
  const resources = results.flatMap((result) => {
    if (extractDomain(result.url) !== domain) return [];
    const descriptor = normalizeText(`${result.url || ""} ${result.title || ""} ${result.snippet || ""}`);
    const role = roleFromTerms(descriptor, /\.pdf(?:$|[?#])/i.test(result.url));
    if (!role) return [];
    return [{
      type: /\.pdf(?:$|[?#])/i.test(result.url) ? "pdf" : "webpage", role,
      url: result.url, found_via: "official_site_search", confidence: "medium",
      label: String(result.title || "").slice(0, 100) || undefined,
      source_url: baseUrl,
      evidence: ["same_official_domain", "site_restricted_search", `${role}_search_result`],
    }];
  });
  return {
    resources: preferResourceVariants(resources),
    request_count: 1,
    search_attempt: response && !Array.isArray(response) && response.request_id
      ? response : undefined,
  };
}

function compareResources(a, b) {
  const roleRank = { menu: 7, drinks: 6, order: 5, booking: 4, specialty: 3, menu_image: 2, venue_page: 1, secondary: 0 };
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  return (roleRank[b.role] || 0) - (roleRank[a.role] || 0)
    || (confidenceRank[b.confidence] || 0) - (confidenceRank[a.confidence] || 0)
    || (b.score || 0) - (a.score || 0)
    || String(a.url).localeCompare(String(b.url));
}

function roleFromTerms(descriptor, isPdf = false) {
  if (hasAnyTerm(descriptor, ORDER_TERMS)) return "order";
  if (hasAnyTerm(descriptor, BOOKING_TERMS)) return "booking";
  if (hasAnyTerm(descriptor, DRINK_TERMS)) return "drinks";
  if (hasAnyTerm(descriptor, MENU_TERMS)) return "menu";
  if (hasAnyTerm(descriptor, SPECIALTY_TERMS)) return "specialty";
  if (isPdf) return "menu";
  return null;
}

function isOrderingUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.startsWith("order.") || hostname.startsWith("orders.")
      || hostname.startsWith("delivery.") || hostname.includes(".order.")
      || hostname.includes(".orders.") || hostname.includes(".delivery.")
      || hostname === "dish.co" || hostname.endsWith(".dish.co")
      || hostname === "ipratico.com" || hostname.endsWith(".ipratico.com");
  } catch { return false; }
}

function extractResourcePageDescriptor(html, url) {
  const source = String(html || "");
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const h1 = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  const canonical = source.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)/i)?.[1] || "";
  const jsonLd = [...source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).join(" ").slice(0, 8_000);
  return normalizeText(`${url} ${stripTags(title)} ${stripTags(h1)} ${canonical} ${jsonLd}`);
}

function decideResourceFreshness({ candidate, finalUrl, body, lastModified, pdfMetadata, referenceDate }) {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const currentYear = Number.isFinite(now.getUTCFullYear()) ? now.getUTCFullYear() : new Date().getUTCFullYear();
  // Date only explicit resource descriptors. Years in arbitrary page HTML are
  // commonly copyright, founding, image, or schema dates and do not date a
  // stable /menu or /order page.
  const metadata = `${finalUrl} ${candidate.label || ""} ${candidate.nearby_text || ""} ${candidate.pdf_metadata || ""} ${pdfMetadata || ""}`;
  const years = [...metadata.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const modified = lastModified ? new Date(lastModified) : null;
  const signals = [...new Set(years)].sort((a, b) => b - a);
  const seasonal = hasAnyTerm(normalizeText(metadata), SEASONAL_TERMS);
  const newestYear = signals[0];
  if (newestYear && newestYear > currentYear) {
    return { status: "review", signals, evidence: ["future_dated_resource"] };
  }
  if (newestYear && newestYear < currentYear) {
    if (seasonal || currentYear - newestYear >= 2) {
      return { status: "stale", signals, evidence: [seasonal ? "stale_seasonal_resource" : "stale_dated_resource"] };
    }
    return { status: "review", signals, evidence: ["previous_year_resource"] };
  }
  if (newestYear === currentYear) return { status: "current", signals, evidence: ["current_year_resource"] };
  if (modified && Number.isFinite(modified.getTime())) {
    const modifiedYear = modified.getUTCFullYear();
    if (seasonal && modifiedYear < currentYear) {
      return { status: "stale", signals: [modifiedYear], evidence: ["stale_seasonal_last_modified"] };
    }
    return { status: "undated", signals: [modifiedYear], evidence: ["stable_undated_resource", "last_modified_observed"] };
  }
  return { status: "undated", signals: [], evidence: ["stable_undated_resource"] };
}

function buildResourceStageMetrics({ candidates, decisions, preCapDropped, postCapDropped }) {
  const roles = {};
  const add = (role, stage, count = 1) => {
    const bucket = roles[role || "unknown"] ||= {
      candidates: 0, accepted: 0, review: 0, rejected: 0, pre_cap_dropped: 0, post_cap_dropped: 0,
    };
    bucket[stage] += count;
  };
  for (const candidate of preferResourceVariants(candidates)) add(candidate.role, "candidates");
  for (const decision of decisions) add(decision.role, decision.status);
  for (const candidate of preCapDropped) add(candidate.role, "pre_cap_dropped");
  for (const candidate of postCapDropped) add(candidate.role, "post_cap_dropped");
  const totals = Object.values(roles).reduce((sum, bucket) => {
    for (const key of Object.keys(sum)) sum[key] += bucket[key];
    return sum;
  }, { candidates: 0, accepted: 0, review: 0, rejected: 0, pre_cap_dropped: 0, post_cap_dropped: 0 });
  return { totals, by_role: Object.fromEntries(Object.entries(roles).sort(([a], [b]) => a.localeCompare(b))) };
}

function meaningfulNameTokens(value) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token));
}
function meaningfulLocationTokens(value) {
  const location = normalizeLocationContext(value);
  return [...new Set([
    location.municipality, location.province, location.region, ...(location.postcodes || []),
  ].flatMap((item) => normalizeText(item).split(" "))
    .filter((token) => token.length >= 4 && !/^[a-z]{2}$/.test(token)))];
}
function requestedPlaceTokens(value) {
  const location = normalizeLocationContext(value);
  const town = normalizeText(location.municipality);
  const province = normalizeText(location.province || PROVINCE_PLACE[location.province_code]);
  return [...new Set([town, ...town.split(" "), province, normalizeText(location.region),
    ...(location.postcodes || []).map(normalizeText)].filter(Boolean))];
}

function venueAliases(restaurant) {
  return [...new Set([restaurant?.name, ...(restaurant?.aliases || [])]
    .map((item) => String(item || "").trim()).filter(Boolean))];
}
function bestAlias(aliases, haystack) {
  return aliases.toSorted((left, right) => {
    const leftExact = haystack.includes(normalizeText(left)) ? 1 : 0;
    const rightExact = haystack.includes(normalizeText(right)) ? 1 : 0;
    return rightExact - leftExact
      || matchedAliasRatio(right, haystack) - matchedAliasRatio(left, haystack)
      || right.length - left.length;
  })[0] || "";
}
function matchedAliasRatio(alias, haystack) {
  const tokens = meaningfulNameTokens(alias);
  return tokens.length ? tokens.filter((token) => haystack.includes(token)).length / tokens.length : 0;
}
function meaningfulAddressTokens(value) {
  return normalizeText(String(value || "").split(",")[0])
    .split(" ")
    .filter((token) => token.length >= 3 && !["via", "viale", "piazza", "corso", "strada", "localita"].includes(token));
}
function normalizedPhones(value) {
  const digits = String(value || "").match(/(?:\+?39[\s.-]*)?(?:\d[\s.-]*){7,12}/g) || [];
  return digits.map((item) => item.replace(/\D/g, "").replace(/^39(?=\d{8,})/, "")).filter((item) => item.length >= 7);
}
function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasAnyTerm(value, terms) {
  const normalized = ` ${normalizeText(value)} `;
  return terms.some((term) => normalized.includes(` ${normalizeText(term)} `));
}
function extractDomain(url) {
  if (!url) return "";
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function resolveUrl(href, base) {
  try { return new URL(decodeEntities(href), base).href; } catch { return ""; }
}
function canonicalUrl(value) {
  try {
    const url = new URL(value); url.hash = "";
    if (url.protocol === "http:" || url.protocol === "https:") url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch { return ""; }
}
function canonicalResourceUrl(value) {
  try {
    const url = new URL(canonicalUrl(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_[ce]id)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return ""; }
}
function sameCanonicalUrl(a, b) { return Boolean(a && b && canonicalUrl(a) === canonicalUrl(b)); }
function isHomepage(url) {
  try { const parsed = new URL(url); return parsed.pathname === "/" || parsed.pathname === ""; } catch { return false; }
}
function crawlCacheKey(url) {
  const canonical = canonicalUrl(url);
  if (!canonical) return String(url || "");
  return isHomepage(canonical) ? new URL(canonical).origin : canonical;
}
function stripTags(value) { return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeEntities(value) {
  return String(value || "").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;|&#160;/gi, " ");
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }
function rejectedScore(reason) {
  return { score: 0, confidence: "low", reasons: [reason], accepted: false, officialCandidate: false };
}
function dedupe(resources) {
  const seen = new Set();
  return resources.filter((resource) => {
    const key = canonicalUrl(resource.url);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
