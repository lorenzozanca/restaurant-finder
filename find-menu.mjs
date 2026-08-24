import { get, getRendered } from "./lib/lib.mjs";
import { search } from "./lib/search.mjs";

const DIRECTORY_DOMAINS = [
  "paginegialle.it", "paginebianche.it",
  "tripadvisor.it", "tripadvisor.com", "restaurantguru.it", "restaurantguru.com",
  "sluurpy.it", "pagina-inizio.com", "oraridiapertura24.it", "wheree.com",
  "outdooractive.com", "virgilio.it", "tuttocitta.it", "foodracers.com",
  "piatti.menu",
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
  "menu", "carta", "listino", "food", "drink", "vino", "vini", "wine",
  "bevande", "birre", "cocktail", "antipasti", "primi", "secondi", "dolci",
];
const ORDER_TERMS = [
  "ordina", "ordine", "ordering", "asporto", "consegna", "domicilio",
  "delivery", "takeaway", "take-away", "prenota", "booking",
];
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
const LODGING_TERMS = ["room", "rooms", "camera", "camere", "suite", "bedroom", "alloggio"];
const MAX_RESOURCES = 6;
const MAX_SECONDARY = 1;
const MAX_IMAGES = 2;

export async function findMenuSources(restaurant, location) {
  const searchResults = await huntViaSearch(restaurant, location);
  const originalWebsite = restaurant.website || "";
  const originalKind = classifyWebsite(originalWebsite);
  const officialCandidate = chooseOfficialWebsite(
    originalKind === "official" ? originalWebsite : "",
    searchResults,
    restaurant,
    location,
  );
  const officialWebsite = officialCandidate?.url || "";
  const officialDomain = extractDomain(officialWebsite);
  const siteResources = officialWebsite ? await huntOnWebsite(officialWebsite) : [];
  const searchResources = [];

  for (const result of searchResults) {
    const scored = scoreSearchCandidate(result, restaurant, location, officialDomain);
    if (!scored.accepted || sameCanonicalUrl(result.url, officialWebsite)) continue;
    const resultDomain = extractDomain(result.url);
    const sameDomain = officialDomain && resultDomain === officialDomain;
    const descriptor = normalizeText(`${result.title} ${result.snippet} ${result.url}`);
    const menuish = hasAnyTerm(descriptor, [...MENU_TERMS, ...ORDER_TERMS, ...SPECIALTY_TERMS]);
    const kind = classifyWebsite(result.url);

    if (sameDomain && menuish) {
      searchResources.push(toResource(result, scored, "menu"));
    } else if (sameDomain && !isHomepage(result.url)) {
      searchResources.push(toResource(result, scored, "venue_page"));
    } else if (kind === "directory" || kind === "social") {
      searchResources.push(toResource(result, scored, "secondary"));
    } else if (menuish || scored.confidence === "high") {
      searchResources.push(toResource(result, scored, "secondary"));
    }
  }

  const resources = rankAndLimitResources([...siteResources, ...searchResources]);
  const directoryUrl = originalWebsite && originalKind !== "official" ? originalWebsite : undefined;
  return {
    website: officialWebsite || undefined,
    website_kind: officialWebsite ? "official" : undefined,
    website_confidence: officialCandidate?.confidence,
    directory_url: directoryUrl,
    resources,
  };
}

async function huntViaSearch(restaurant, location) {
  const name = String(restaurant.name || "").trim();
  const town = String(location || "").trim().split(/\s+/)[0] || "";
  const street = String(restaurant.address || "").split(",")[0].trim();
  const queries = [`"${name}" "${town}" ristorante`, `"${name}" "${town}" menu`];
  if (meaningfulNameTokens(name).length === 0 && street) {
    queries[0] = `"${name}" "${street}" "${town}"`;
  }

  const resultIndex = new Map();
  const results = [];
  const addResult = (result) => {
    const key = canonicalUrl(result.url);
    if (!key) return;
    const index = resultIndex.get(key);
    if (index === undefined) {
      resultIndex.set(key, results.length);
      results.push(result);
      return;
    }
    const existing = results[index];
    const resultHasRicherEvidence = `${result.title || ""} ${result.snippet || ""}`.length
      > `${existing.title || ""} ${existing.snippet || ""}`.length;
    results[index] = {
      ...existing,
      url: resultHasRicherEvidence ? result.url : existing.url,
      title: String(result.title || "").length > String(existing.title || "").length
        ? result.title : existing.title,
      snippet: String(result.snippet || "").length > String(existing.snippet || "").length
        ? result.snippet : existing.snippet,
    };
  };
  for (const query of [...new Set(queries)]) {
    for (const result of await search(query, 8)) addResult(result);
  }
  // Quoted searches can be too strict for small venues. A single loose fallback
  // restores recall, but every hit still has to pass the identity/context scorer.
  const hasValidatedCandidate = results.some((result) =>
    scoreSearchCandidate(result, restaurant, location).accepted
  );
  const initialNeedsSpecificPage = classifyWebsite(restaurant.website) !== "official"
    || isHomepage(restaurant.website);
  if (!hasValidatedCandidate || initialNeedsSpecificPage) {
    const shortName = name.replace(/^(ristorante|pizzeria|trattoria|bar|pub|osteria|hotel)\s+/i, "").trim();
    for (const result of await search(`${shortName} ${location}`, 8)) addResult(result);
  }
  return results;
}

function chooseOfficialWebsite(initialWebsite, results, restaurant, location) {
  const candidates = [];
  if (initialWebsite) {
    candidates.push({
      url: initialWebsite,
      score: isHomepage(initialWebsite) ? 82 : 88,
      confidence: "medium",
      initial: true,
    });
  }
  for (const result of results) {
    if (classifyWebsite(result.url) !== "official") continue;
    const scored = scoreSearchCandidate(result, restaurant, location);
    if (!scored.accepted || !scored.officialCandidate) continue;
    candidates.push({ ...result, ...scored });
  }
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (isHomepage(a.url) !== isHomepage(b.url)) return isHomepage(a.url) ? 1 : -1;
    return Number(Boolean(a.initial)) - Number(Boolean(b.initial));
  });
  return candidates[0] || null;
}

async function huntOnWebsite(website) {
  let html;
  try {
    const res = await get(website, { timeout: 20_000 });
    if (!res.ok) return [];
    html = res.body;
  } catch {
    return [];
  }
  const textLen = stripTags(html).length;
  if (textLen < 200 || /enable\s?(js|javascript)/i.test(html)) {
    try {
      const rendered = await getRendered(website, { timeout: 25_000 });
      if (rendered.ok && rendered.body && rendered.body.length > html.length + 100) html = rendered.body;
    } catch {}
  }
  const resources = extractRelevantSiteResources(html, website);
  if (resources.length === 0) resources.push(...await trySitemaps(website));
  return resources;
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
    if (extractDomain(resolved) !== domain || sameCanonicalUrl(resolved, website)) continue;
    const label = decodeEntities(stripTags(match[4])).trim();
    const imageText = [...match[4].matchAll(/\b(?:alt|title)\s*=\s*["']([^"']+)["']/gi)]
      .map((item) => item[1]).join(" ");
    const descriptor = normalizeText(`${resolved} ${label} ${imageText}`);
    if (hasAnyTerm(descriptor, BOILERPLATE_TERMS)) continue;
    const isPdf = /\.pdf(?:$|[?#])/i.test(resolved);
    const isImage = /\.(?:png|jpe?g|gif|webp|avif)(?:$|[?#])/i.test(resolved);
    const hasMenu = hasAnyTerm(descriptor, MENU_TERMS);
    const hasOrder = hasAnyTerm(descriptor, ORDER_TERMS);
    const hasSpecialty = hasAnyTerm(descriptor, SPECIALTY_TERMS);
    if (!isPdf && !hasMenu && !hasOrder && !hasSpecialty) continue;
    if (hasOrder && hasAnyTerm(descriptor, LODGING_TERMS) && !hasMenu && !hasSpecialty) continue;
    resources.push({
      type: isPdf ? "pdf" : isImage ? "image" : "webpage",
      role: isImage ? "menu_image" : hasOrder ? "order" : hasMenu || isPdf ? "menu" : "specialty",
      url: resolved,
      found_via: "official_website",
      confidence: isImage ? "low" : isPdf || hasMenu || hasOrder ? "high" : "medium",
      label: label.slice(0, 100) || undefined,
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
    });
    imageCount++;
  }
  return dedupe(resources);
}

export function scoreSearchCandidate(result, restaurant, location, officialDomain = "") {
  const url = String(result.url || "");
  const domain = extractDomain(url);
  if (!domain || HARD_BLOCKED_DOMAINS.some((item) => domain.includes(item))) return rejectedScore("blocked_domain");
  const name = normalizeText(restaurant.name || "");
  const haystack = normalizeText(`${result.title || ""} ${result.snippet || ""} ${decodeURIComponentSafe(url)}`);
  const nameTokens = meaningfulNameTokens(restaurant.name);
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
  return { score, confidence, reasons, accepted, officialCandidate };
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
  };
}

function rankAndLimitResources(resources) {
  const roleRank = { menu: 5, order: 4, specialty: 3, menu_image: 2, venue_page: 2, secondary: 1 };
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  const sorted = dedupe(resources).sort((a, b) =>
    (roleRank[b.role] || 0) - (roleRank[a.role] || 0)
      || (confidenceRank[b.confidence] || 0) - (confidenceRank[a.confidence] || 0)
      || (b.score || 0) - (a.score || 0));
  const selected = [];
  const hasFirstPartyResource = resources.some((resource) =>
    String(resource.found_via || "").startsWith("official_")
  );
  let secondaryCount = 0;
  let imageCount = 0;
  for (const resource of sorted) {
    if (resource.role === "secondary" && hasFirstPartyResource) continue;
    if (resource.role === "secondary" && secondaryCount >= MAX_SECONDARY) continue;
    if (resource.type === "image" && imageCount >= MAX_IMAGES) continue;
    if (resource.role === "secondary") secondaryCount++;
    if (resource.type === "image") imageCount++;
    selected.push(resource);
    if (selected.length >= MAX_RESOURCES) break;
  }
  return selected;
}

async function trySitemaps(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const resources = [];
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    let body;
    try {
      const response = await get(origin + path, { timeout: 15_000 });
      if (!response.ok) continue;
      body = response.body;
    } catch { continue; }
    for (const match of body.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const url = decodeEntities(match[1]).trim();
      if (extractDomain(url) !== extractDomain(origin)) continue;
      const descriptor = normalizeText(url);
      if (!hasAnyTerm(descriptor, [...MENU_TERMS, ...ORDER_TERMS, ...SPECIALTY_TERMS])) continue;
      resources.push({
        type: /\.pdf(?:$|[?#])/i.test(url) ? "pdf" : "webpage",
        role: hasAnyTerm(descriptor, ORDER_TERMS) ? "order" : "menu",
        url, found_via: "official_sitemap", confidence: "medium",
      });
    }
    if (resources.length) break;
  }
  return dedupe(resources).slice(0, MAX_RESOURCES);
}

function meaningfulNameTokens(value) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token));
}
function meaningfulLocationTokens(value) {
  return normalizeText(value).split(" ").filter((token) => token.length >= 4 && !/^[a-z]{2}$/.test(token));
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
function sameCanonicalUrl(a, b) { return Boolean(a && b && canonicalUrl(a) === canonicalUrl(b)); }
function isHomepage(url) {
  try { const parsed = new URL(url); return parsed.pathname === "/" || parsed.pathname === ""; } catch { return false; }
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
