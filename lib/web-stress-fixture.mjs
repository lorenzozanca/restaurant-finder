import { createHash } from "node:crypto";
import { registrableDomain } from "./publisher-ownership.mjs";

const SOCIAL = new Set(["facebook.com", "instagram.com", "tiktok.com", "x.com", "youtube.com"]);
const DIRECTORY = new Set(["tripadvisor.it", "tripadvisor.com", "restaurantguru.it", "restaurantguru.com",
  "localshop24.com", "paginegialle.it", "yelp.com", "mymenuweb.com", "ilmangione.it", "apetime.com",
  "ilborghista.it", "trustpilot.com", "trustpilot.it", "offertevolantini.it"]);
const PLATFORM = new Set(["thefork.it", "thefork.com", "justeat.it", "deliveroo.it", "glovoapp.com",
  "ubereats.com", "foodracers.com"]);
const EDITORIAL = new Set(["gamberorosso.it", "dissapore.com", "lacucinaitaliana.it"]);

export function classifyPublisherUrl(value) {
  const domain = registrableDomain(value);
  if (!domain) return "unrelated";
  if (SOCIAL.has(domain)) return "social";
  if (DIRECTORY.has(domain)) return "directory";
  if (PLATFORM.has(domain)) return "booking_or_order_platform";
  if (EDITORIAL.has(domain)) return "editorial_or_review";
  if (/^(?:menu|mymenu|res-menu|dish|flipbook|cdnmenu)\./.test(new URL(value).hostname)
      || /(?:menuweb|menudigitale|leggimenu|qodeup)/.test(domain)) return "menu_mirror";
  return "uncertain";
}

export function normalizeCandidateUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch { return ""; }
}

export function validateWebFixtureDocument(document, options = {}) {
  if (document?.schema_version !== 1 || !Array.isArray(document.entries)) {
    throw new Error("invalid web stress fixture document");
  }
  if (document.source !== "codex_integrated_web_search" || document.brave_requests_made !== 0) {
    throw new Error("web fixture must be zero-Brave Codex integrated search research");
  }
  if (!/^[a-f0-9]{64}$/.test(document.selection_fingerprint_sha256 || "")) {
    throw new Error("web fixture selection fingerprint is missing");
  }
  const limit = Number(document.bounded_result_limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("invalid bounded result limit");
  const seen = new Set();
  for (const entry of document.entries) {
    if (!entry.venue_id || seen.has(entry.venue_id)) throw new Error("duplicate or missing fixture venue ID");
    seen.add(entry.venue_id);
    if (!entry.query || !validTimestamp(entry.retrieved_at)) throw new Error("fixture query or retrieval time missing");
    if (!Array.isArray(entry.candidates) || entry.candidates.length > limit) {
      throw new Error("fixture exceeds bounded result limit");
    }
    for (const candidate of entry.candidates) {
      if (!httpUrl(candidate.url) || normalizeCandidateUrl(candidate.url) !== candidate.url
          || typeof candidate.title !== "string" || candidate.title.length > 200) {
        throw new Error("fixture candidate metadata is invalid");
      }
      if (Object.keys(candidate).some((key) => !["title", "url", "publisher_class"].includes(key))) {
        throw new Error("fixture contains uncontrolled result metadata");
      }
    }
  }
  if (options.expectedEntries !== undefined && document.entries.length !== options.expectedEntries) {
    throw new Error(`expected ${options.expectedEntries} entries, found ${document.entries.length}`);
  }
  return { entries: document.entries.length,
    candidates: document.entries.reduce((sum, entry) => sum + entry.candidates.length, 0),
    fingerprint: digest(JSON.stringify(document.entries)) };
}

export function prelabelWebFixture(document) {
  validateWebFixtureDocument(document);
  return { ...document, entries: document.entries.map((entry) => ({ ...entry,
    candidates: entry.candidates.map((candidate) => ({ ...candidate,
      publisher_class: classifyPublisherUrl(candidate.url) })),
  })) };
}

export function evaluateWebStress(entries) {
  const reviewed = entries.filter((entry) => conclusiveReview(entry.adjudication));
  const publications = reviewed.filter((entry) => entry.prediction?.official_website_url);
  const truePublications = publications.filter((entry) => sameDomain(
    entry.prediction.official_website_url, entry.adjudication.official_website_url));
  const officialSites = reviewed.filter((entry) => entry.adjudication.official_website_status === "accepted");
  const recalled = officialSites.filter((entry) => sameDomain(
    entry.prediction?.official_website_url, entry.adjudication.official_website_url));
  const discovered = officialSites.filter((entry) => entry.candidates.some((candidate) =>
    sameDomain(candidate.url, entry.adjudication.official_website_url)));
  return {
    reviewed: reviewed.length,
    publications: publications.length,
    official_sites: officialSites.length,
    official_site_precision: ratio(truePublications.length, publications.length),
    official_site_precision_wilson_95: wilson(truePublications.length, publications.length),
    official_site_recall: ratio(recalled.length, officialSites.length),
    official_site_recall_wilson_95: wilson(recalled.length, officialSites.length),
    search_discovery_recall: ratio(discovered.length, officialSites.length),
    search_discovery_recall_wilson_95: wilson(discovered.length, officialSites.length),
    abstentions: reviewed.length - publications.length,
    coverage: ratio(publications.length, reviewed.length),
    passes_non_vacuity: publications.length > 0,
    passes_precision_target: publications.length > 0
      && wilson(truePublications.length, publications.length).lower >= 0.95,
  };
}

export function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return { lower: null, upper: null };
  const p = successes / total, z2 = z * z, denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { lower: center - margin, upper: center + margin };
}
function conclusiveReview(value) {
  return value && ["accepted", "no_official_site"].includes(value.official_website_status)
    && value.reviewer && validTimestamp(value.reviewed_at)
    && Array.isArray(value.evidence_urls) && value.evidence_urls.length > 0
    && (value.official_website_status !== "accepted" || httpUrl(value.official_website_url));
}
function sameDomain(left, right) { return Boolean(left && right
  && registrableDomain(left) === registrableDomain(right)); }
function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
function httpUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
function validTimestamp(value) { return Number.isFinite(Date.parse(value)); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
