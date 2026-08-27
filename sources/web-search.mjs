import { searchDetailed } from "../lib/search.mjs";
import { get } from "../lib/lib.mjs";
import { sourceResult } from "../source-run.mjs";
import { normalizeLocationContext } from "../lib/location-context.mjs";

export async function discover(locationValue, province = "", options = {}) {
  if (province && typeof province === "object") { options = province; province = ""; }
  const location = normalizeLocationContext(locationValue, province);
  const town = location.municipality;
  province = location.province_code || "";
  const searchFn = options.searchDetailedFn || searchDetailed;
  const queries = options.queries || [
    `ristoranti ${town} sito web`,
    `trattoria pizzeria ${town}`,
    `bar pub paninoteca ${town}`,
  ];

  if (queries.length > 4) throw new Error("broad discovery query budget exceeds four");

  const all = [];
  const responses = [];
  for (const querySpec of queries) {
    const q = typeof querySpec === "string" ? querySpec : querySpec.query;
    const response = await searchFn({
      query: q, limit: 12, purpose: "broad_discovery",
      location,
    });
    responses.push(response);
    for (const r of response.outcome === "relevant" ? response.results : []) {
      all.push({ ...r, _discovery_query: q,
        _discovery_template_id: typeof querySpec === "string" ? undefined : querySpec.id });
    }
  }

  const restaurants = [];
  for (const r of all) {
    const pageRejections = classifyDiscoveryPage(r.title, r.snippet, r.url);
    if (pageRejections.length) {
      reportDecision(options, r, { status: "rejected", reasons: pageRejections, evidence: [] });
      continue;
    }

    let metadata = {};
    try {
      const page = await get(r.url, { timeout: 15_000 });
      if (page.ok) metadata = extractPageMetadata(page.body, town);
    } catch {}

    // Structured data from the venue page is stronger identity evidence than a
    // search title such as "Ristorante Pizzeria in centro - Brand".
    const name = metadata.name
      || extractRestaurantName(r.title, r.snippet, r.url);
    if (!name) {
      reportDecision(options, r, { status: "rejected", reasons: ["missing_venue_name"], evidence: [] });
      continue;
    }

    const admission = evaluateWebCandidate({ ...r, name, metadata }, {
      town, province, postcodes: location.postcodes,
    });
    reportDecision(options, r, admission, name);
    if (admission.status !== "accepted") continue;

    restaurants.push({
      name,
      type: guessType(r.title, `${r.snippet} ${metadata.description || ""}`),
      address: metadata.address || "",
      address_components: metadata.address_components,
      postcode: metadata.address_components?.postal_code || metadata.address_components?.postcode,
      address_source: metadata.address_source,
      website: r.url,
      provider_record_url: r.url,
      phone: metadata.phone,
      source: "web_search",
      snippet: r.snippet,
      admission,
      _discovery_query: r._discovery_query,
      _discovery_template_id: r._discovery_template_id,
    });
  }

  const outcomes = responses.map((response) => response.outcome);
  const degraded = outcomes.some((outcome) =>
    ["irrelevant", "rate_limited", "provider_failed", "budget_exhausted"].includes(outcome));
  const queryYield = summarizeQueryYield(queries, responses, restaurants);
  const published = restaurants.map(({ _discovery_query, _discovery_template_id, ...item }) => item);
  return sourceResult(published, {
    status: degraded ? "degraded" : "succeeded",
    useful_result_count: published.length,
    reason: degraded ? "unhealthy_search_response" : undefined,
    search_outcomes: outcomes,
    search_attempts: responses,
    query_yield: queryYield,
  });
}

function summarizeQueryYield(queries, responses, restaurants) {
  const seen = new Set();
  return queries.map((querySpec, index) => {
    const query = typeof querySpec === "string" ? querySpec : querySpec.query;
    const accepted = restaurants.filter((item) => item._discovery_query === query);
    let marginal = 0;
    for (const item of accepted) {
      const key = `${normalizePlace(item.name)}|${hostnameBrand(item.website)}`;
      if (!seen.has(key)) { seen.add(key); marginal++; }
    }
    return {
      template_id: typeof querySpec === "string" ? "legacy_unmeasured" : querySpec.id,
      query,
      outcome: responses[index]?.outcome || "provider_failed",
      result_count: responses[index]?.results?.length || 0,
      accepted_candidate_count: accepted.length,
      marginal_candidate_count: marginal,
    };
  });
}

export function extractRestaurantName(title, snippet = "", url = "") {
  const combined = `${title} ${snippet}`.toLowerCase();
  // Search titles often lead with a generic SEO phrase and put the actual
  // brand after a dash: "Ristorante Pizzeria in centro - Al Giardinetto
  // Ristorante Pizzeria tipico".
  const titleSegments = title.split(/\s*[-–|]\s*/).map((segment) => segment.trim());
  for (const segment of titleSegments.slice(1)) {
    const branded = segment.match(/^(.{3,45}?)\s+(?:ristorante|pizzeria|trattoria|osteria|bar|pub)\b/i);
    if (branded && !/^(?:home|homepage|ristorante|pizzeria)$/i.test(branded[1].trim())) {
      return capitalize(branded[1]);
    }
  }
  const patterns = [
    /(?:ristorante|trattoria|pizzeria|osteria|bar|pub|paninoteca|birreria|enoteca)\s+([A-ZÀ-Ü][a-zà-ü']+(?:\s+[A-ZÀ-Üa-zà-ü']+){0,3})\b/i,
  ];

  for (const p of patterns) {
    const m = title.match(p) || snippet.match(p);
    if (m) return capitalize(m[1]);
  }

  const titleClean = title
    .replace(/\s*[-–|]\s*.*$/, "")
    .replace(/^(?:Ristorante|Trattoria|Pizzeria|Osteria|Bar)\s+/i, "")
    .trim();

  if (titleClean.length > 3 && titleClean.length < 50 && /\s/.test(titleClean)) {
    return capitalize(titleClean);
  }

  // Search engines often title a small business homepage "Home - Brand".
  // Permit a one-word title only when it matches the site's own hostname;
  // this keeps generic one-word result titles from becoming venues.
  const hostBrand = hostnameBrand(url);
  const segments = title.split(/\s*[-–|]\s*/).map((s) => s.trim());
  const branded = segments.find((segment) =>
    normalizeToken(segment) === normalizeToken(hostBrand)
  );
  if (branded && branded.length >= 3 && branded.length < 50) {
    return capitalize(branded);
  }

  return null;
}

export function extractPageMetadata(html, town) {
  const metadata = {};
  let namePriority = 0;

  const description = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  if (description) metadata.description = decodeEntities(description[1]).trim();

  for (const value of extractJsonLd(html)) {
    visitJson(value, (node) => {
      if (!node || typeof node !== "object") return;
      const type = String(node["@type"] || "").toLowerCase();
      const priority = /restaurant|foodestablishment|cafe|bar|pub/.test(type) ? 3
        : /localbusiness|organization/.test(type) ? 2
          : /website/.test(type) ? 1 : 0;
      const candidateName = priority ? cleanName(node.name) : "";
      if (candidateName && priority > namePriority) {
        metadata.name = candidateName;
        namePriority = priority;
      }
      if (priority === 3) metadata.venue_schema = true;
      if (!metadata.phone && node.telephone) metadata.phone = String(node.telephone).trim();
      if (!metadata.address && node.address) {
        const structured = parseStructuredAddress(node.address);
        metadata.address = structured.address;
        metadata.address_components = structured.components;
        metadata.address_source = "structured_data";
      }
    });
  }

  const text = decodeEntities(stripTags(html));
  if (!metadata.address) {
    const visible = extractItalianAddress(text);
    if (visible) {
      metadata.address = visible;
      metadata.address_components = { street: visible };
      metadata.address_source = "page_text";
    }
  }
  if (town && includesPlace(text, town)) {
    metadata.location_mentions = [{ type: "municipality", value: town, source: "page_text" }];
  }
  if (!metadata.phone) {
    const telLink = html.match(/href=["']tel:([^"']+)/i);
    const phone = telLink || text.match(/(?:\+39\s*)?(?:0\d{1,3})[.\s-]*\d{5,8}\b/);
    if (phone) {
      metadata.phone = (telLink ? telLink[1] : phone[0])
        .replace(/\s+/g, " ").trim();
    }
  }
  return metadata;
}

export function classifyDiscoveryPage(title, snippet, url) {
  const combined = `${title} ${snippet}`.toLowerCase();
  const urlLower = (url || "").toLowerCase();
  const reasons = [];

  const urlBlock = [
    "paginegialle.it", "guide.michelin.com",
    "tripadvisor.it", "tripadvisor.com",
    "tuttocitta.it", "italia.it",
    "restaurantguru", "sluurpy",
    "facebook.com", "instagram.com",
    "thefork", "google.com/maps",
    "pagina-inizio.com",
    "paginebianche.it", "reteimprese.it", "visitcopenhagen",
    "piatti.menu/list", "piatti.menu/restaurants",
    "virgilio.it/italia/",
    "truckfly.com/",
  ];
  if (urlBlock.some((d) => urlLower.includes(d))) reasons.push("directory_or_aggregator");

  if (/\b(?:vicino a me|near me)\b/i.test(`${title} ${snippet} ${url}`)) {
    reasons.push("generic_near_me_page");
  }
  if (/\b(?:contributori ai progetti wikimedia|wikipedia|wikimedia commons)\b/i.test(combined)) {
    reasons.push("boilerplate_identity");
  }

  const indicators = [
    "migliori ristoranti", "i migliori", "migliori pizzerie",
    "top 10", "top 15", "guida ai", "dove mangiare",
    "ristoranti a ", "pizzerie a ", "trattorie a ", "osterie a ",
    "classifica", "recensioni", "i 10 migliori", "i 5 migliori",
    "elenco", "lista dei", "cerca in zona", "aggiornamento al ",
    "the fork", "tripadvisor", "google maps", "pagine gialle",
    "pagina iniziale", "le migliori", "scopri i migliori",
    "mappa dei ristoranti", "mappa ristoranti", "mappa dei",
    "ricerca ristoranti", "paninoteca a ", "paninoteche a ",
    "indirizzi e orari", "orari di apertura",
    "top ristoranti", "migliori ristoranti",
  ];
  if (indicators.some((w) => combined.includes(w))) reasons.push("editorial_or_list_page");
  return [...new Set(reasons)];
}

export function evaluateWebCandidate(candidate, target) {
  const title = candidate.title || "";
  const snippet = candidate.snippet || "";
  const metadata = candidate.metadata || {};
  const pageReasons = classifyDiscoveryPage(title, snippet, candidate.url || "");
  if (pageReasons.length) return rejected(pageReasons);

  const targetTown = normalizePlace(target.town);
  const targetProvince = normalizeProvince(target.province);
  const components = metadata.address_components || {};
  const evidence = [];
  const contradictions = [];

  const normalizedName = normalizePlace(candidate.name);
  if (normalizedName === targetTown
      || /^(?:selezione|ristoranti|ristorante|menu|menù)$/.test(normalizedName)
      || normalizedName.startsWith("ristoranti ")) {
    return rejected(["generic_or_location_name"]);
  }

  if (components.locality) {
    if (normalizePlace(components.locality) === targetTown) {
      evidence.push({ type: "municipality", source: "structured_address", value: components.locality });
    } else {
      contradictions.push("municipality_contradiction");
    }
  }
  if (components.province && targetProvince) {
    const componentProvince = normalizeProvince(components.province);
    if (!componentProvince) {
      // Schema.org addressRegion is also commonly an Italian region (for
      // example "Veneto"), which is not a province contradiction.
    } else if (componentProvince === targetProvince) {
      evidence.push({ type: "province", source: "structured_address", value: components.province });
    } else {
      contradictions.push("province_contradiction");
    }
  }
  const targetPostcodes = new Set((target.postcodes || []).map((value) => String(value)));
  const candidatePostcode = String(components.postal_code || components.postcode
    || String(metadata.address || "").match(/\b\d{5}\b/)?.[0] || "");
  if (candidatePostcode) {
    if (targetPostcodes.size && !targetPostcodes.has(candidatePostcode)) {
      contradictions.push("postcode_contradiction");
    } else if (targetPostcodes.has(candidatePostcode)) {
      evidence.push({ type: "postcode", source: "structured_address", value: candidatePostcode });
    }
  }

  for (const mention of metadata.location_mentions || []) {
    if (mention.type === "municipality" && normalizePlace(mention.value) === targetTown) {
      evidence.push(mention);
    }
  }

  const resultText = `${title} ${snippet} ${metadata.description || ""}`;
  if (target.town && includesPlace(resultText, target.town)) {
    evidence.push({ type: "municipality", source: "search_result", value: target.town });
  }
  const mentionedProvinces = extractProvinceMentions(resultText);
  if (targetProvince && mentionedProvinces.some((value) => normalizeProvince(value) !== targetProvince)) {
    contradictions.push("province_contradiction");
  }
  if (targetProvince && mentionedProvinces.some((value) => normalizeProvince(value) === targetProvince)) {
    evidence.push({ type: "province", source: "search_result", value: target.province });
  }

  if (contradictions.length) return rejected([...new Set(contradictions)], evidence);

  const identityEvidence = venueIdentityEvidence(candidate);
  if (!identityEvidence.length) return rejected(["insufficient_venue_identity"], evidence);
  if (!evidence.some((item) => item.type === "municipality")) {
    return rejected(["insufficient_location_evidence"], evidence.concat(identityEvidence));
  }
  return { status: "accepted", reasons: ["positive_identity_and_location"], evidence: dedupeEvidence(evidence.concat(identityEvidence)) };
}

function guessType(title, snippet) {
  const combined = `${title} ${snippet}`.toLowerCase();
  if (combined.includes("pizzeria")) return "pizzeria";
  if (combined.includes("trattoria")) return "trattoria";
  if (combined.includes("osteria")) return "osteria";
  if (combined.includes("paninoteca")) return "paninoteca";
  if (combined.includes("birreria")) return "pub";
  if (combined.includes("pub ") || combined.endsWith("pub")) return "pub";
  if (combined.includes("bar ")) return "bar";
  if (combined.includes("enoteca")) return "enoteca";
  if (combined.includes("ristorante")) return "restaurant";
  return "restaurant";
}

function capitalize(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function hostnameBrand(url) {
  try {
    const labels = new URL(url).hostname.replace(/^www\./, "").split(".");
    return labels[0] === "wordpress" ? "" : labels[0];
  } catch {
    return "";
  }
}

function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9à-ù]/g, "");
}

function extractJsonLd(html) {
  const values = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try { values.push(JSON.parse(decodeEntities(match[1]))); } catch {}
  }
  return values;
}

function visitJson(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (child && typeof child === "object") visitJson(child, visitor);
  }
}

function parseStructuredAddress(address) {
  if (typeof address === "string") {
    return { address: address.trim(), components: { source_text: address.trim() } };
  }
  if (!address || typeof address !== "object") return { address: "", components: {} };
  const components = {
    street: cleanValue(address.streetAddress),
    postal_code: cleanValue(address.postalCode),
    locality: cleanValue(address.addressLocality),
    province: cleanValue(address.addressRegion),
    country: cleanValue(typeof address.addressCountry === "object"
      ? address.addressCountry.name : address.addressCountry),
  };
  for (const key of Object.keys(components)) {
    if (!components[key]) delete components[key];
  }
  return {
    address: [components.street, components.postal_code, components.locality, components.province]
      .filter(Boolean).join(", ").trim(),
    components,
  };
}

function extractItalianAddress(text) {
  const street = text.match(/\b(?:via|viale|piazza|piazzale|corso|largo|vicolo|strada|località|borgo|contrada)\s+[a-zà-ù' .-]{1,55}?\s*,?\s*\d+(?:\s*\/\s*[a-z0-9]+)?\b/i);
  if (!street) return "";
  return street[0]
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\/\s*/g, "/")
    .trim();
}

function venueIdentityEvidence(candidate) {
  const evidence = [];
  const combined = `${candidate.title || ""} ${candidate.snippet || ""} ${candidate.metadata?.description || ""}`;
  if (/\b(?:ristorante|trattoria|pizzeria|osteria|bar|pub|paninoteca|birreria|enoteca|cafe|caffè)\b/i.test(combined)) {
    evidence.push({ type: "venue_identity", source: "search_result", value: "food_venue_term" });
  }
  if (candidate.metadata?.venue_schema) {
    evidence.push({ type: "venue_identity", source: "structured_data", value: "food_venue_schema" });
  }
  const hostBrand = normalizeToken(hostnameBrand(candidate.url || ""));
  const name = normalizeToken(candidate.name || "");
  if (hostBrand.length >= 4 && name.length >= 4 && (hostBrand.includes(name) || name.includes(hostBrand))) {
    evidence.push({ type: "venue_identity", source: "domain", value: "name_domain_match" });
  }
  return evidence;
}

const PROVINCE_ALIASES = new Map([
  ["tv", "treviso"], ["treviso", "treviso"],
  ["ud", "udine"], ["udine", "udine"],
  ["me", "messina"], ["messina", "messina"],
  ["le", "lecce"], ["lecce", "lecce"],
  ["pr", "parma"], ["parma", "parma"],
  ["rm", "roma"], ["roma", "roma"],
  ["bg", "bergamo"], ["bergamo", "bergamo"],
  ["mi", "milano"], ["milano", "milano"],
  ["co", "como"], ["como", "como"],
]);

function extractProvinceMentions(text) {
  const searchable = String(text || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const found = [];
  for (const [alias, canonical] of PROVINCE_ALIASES) {
    if (alias.length > 2 && new RegExp(`(?:provincia\\s+di|[,;(])\\s*${escapeRegExp(alias)}\\b`).test(searchable)) {
      found.push(canonical);
    }
  }
  for (const match of String(text).matchAll(/\(([A-Z]{2})\)/g)) {
    found.push(match[1]);
  }
  return [...new Set(found)];
}

function normalizeProvince(value) {
  const normalized = normalizePlace(value);
  return PROVINCE_ALIASES.get(normalized) || (/^[a-z]{2}$/.test(normalized) ? normalized : "");
}

function normalizePlace(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function includesPlace(text, place) {
  const normalizedText = ` ${normalizePlace(text)} `;
  const normalizedPlace = normalizePlace(place);
  return Boolean(normalizedPlace) && normalizedText.includes(` ${normalizedPlace} `);
}

function rejected(reasons, evidence = []) {
  return { status: "rejected", reasons, evidence: dedupeEvidence(evidence) };
}

function dedupeEvidence(evidence) {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = `${item.type}|${item.source}|${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reportDecision(options, result, decision, name = "") {
  if (typeof options.onDecision !== "function") return;
  options.onDecision({
    name: name || undefined,
    url: result.url,
    status: decision.status,
    reasons: decision.reasons,
    evidence: decision.evidence,
  });
}

function cleanValue(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (name.length < 3 || name.length >= 50) return "";
  if (/^(ristorante|pizzeria|trattoria|osteria|bar|home|homepage)$/i.test(name)) return "";
  return capitalize(name);
}
