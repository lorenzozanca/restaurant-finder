import { createHash } from "node:crypto";
import { registrableDomain } from "./publisher-ownership.mjs";

const SOCIAL = new Set(["facebook.com", "instagram.com", "tiktok.com", "x.com", "youtube.com"]);
const DIRECTORY = new Set(["tripadvisor.it", "tripadvisor.com", "restaurantguru.it", "restaurantguru.com",
  "localshop24.com", "paginegialle.it", "yelp.com", "mymenuweb.com", "ilmangione.it", "apetime.com",
  "ilborghista.it", "trustpilot.com", "trustpilot.it", "offertevolantini.it"]);
const PLATFORM = new Set(["thefork.it", "thefork.com", "justeat.it", "deliveroo.it", "glovoapp.com",
  "ubereats.com", "foodracers.com"]);
const EDITORIAL = new Set(["gamberorosso.it", "dissapore.com", "lacucinaitaliana.it"]);
const PUBLISHER_CLASSES = new Set(["official", "directory", "menu_mirror",
  "booking_or_order_platform", "editorial_or_review", "social", "unrelated", "uncertain"]);
const OWNERSHIP_STATUSES = new Set(["verified", "rejected", "uncertain"]);
const OFFICIAL_WEBSITE_STATUSES = new Set(["accepted", "no_official_site", "uncertain"]);
const OWNERSHIP_METHODS = new Set(["manual_first_party_review", "official_registry",
  "verified_platform_claim", "verified_reciprocal_link"]);

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

export function validateWebAdjudicationDocument(document, fixtureDocuments, options = {}) {
  if (document?.schema_version !== 1 || !["development", "locked_holdout"].includes(document.partition)
      || document.source !== "independent_fixture_review" || !Array.isArray(document.entries)) {
    throw new Error("invalid web adjudication document");
  }
  if (options.expectedPartition && document.partition !== options.expectedPartition) {
    throw new Error("web adjudication partition mismatch");
  }
  if (!/^[a-f0-9]{64}$/.test(document.selection_fingerprint_sha256 || "")
      || !document.reviewer || !validTimestamp(document.reviewed_at)) {
    throw new Error("web adjudication provenance is missing");
  }
  const fixtures = Array.isArray(fixtureDocuments) ? fixtureDocuments : [fixtureDocuments];
  const fixtureEntries = new Map();
  for (const fixture of fixtures) {
    validateWebFixtureDocument(fixture);
    if (fixture.selection_fingerprint_sha256 !== document.selection_fingerprint_sha256) {
      throw new Error("adjudication selection fingerprint mismatch");
    }
    for (const entry of fixture.entries) {
      if (fixtureEntries.has(entry.venue_id)) throw new Error("duplicate venue across web fixtures");
      fixtureEntries.set(entry.venue_id, entry);
    }
  }
  const seenVenues = new Set();
  const publisherClasses = Object.fromEntries([...PUBLISHER_CLASSES].map((value) => [value, 0]));
  const ownershipStatuses = Object.fromEntries([...OWNERSHIP_STATUSES].map((value) => [value, 0]));
  for (const review of document.entries) {
    const fixture = fixtureEntries.get(review.venue_id);
    if (!fixture || seenVenues.has(review.venue_id)) {
      throw new Error("adjudication has an unknown or duplicate venue");
    }
    seenVenues.add(review.venue_id);
    if (!OFFICIAL_WEBSITE_STATUSES.has(review.official_website_status)
        || !Array.isArray(review.evidence_urls)
        || (fixture.candidates.length > 0 && review.evidence_urls.length === 0)
        || !Array.isArray(review.domain_reviews)) {
      throw new Error("adjudication outcome is incomplete");
    }
    const candidateUrls = new Set(fixture.candidates.map((candidate) => candidate.url));
    if (review.evidence_urls.some((url) => !candidateUrls.has(url))) {
      throw new Error("venue adjudication evidence is outside its bounded fixture");
    }
    const candidateDomains = new Set(fixture.candidates.map((candidate) => registrableDomain(candidate.url)));
    const reviewedDomains = new Set();
    for (const domainReview of review.domain_reviews) {
      const { registrable_domain: domain, publisher_class: publisherClass,
        ownership_status: ownershipStatus, evidence_urls: evidenceUrls } = domainReview;
      if (!candidateDomains.has(domain) || reviewedDomains.has(domain)
          || !PUBLISHER_CLASSES.has(publisherClass) || !OWNERSHIP_STATUSES.has(ownershipStatus)
          || !Array.isArray(evidenceUrls) || evidenceUrls.length === 0
          || evidenceUrls.some((url) => !candidateUrls.has(url) || registrableDomain(url) !== domain)) {
        throw new Error("invalid or incomplete publisher-domain adjudication");
      }
      if (ownershipStatus === "verified" && publisherClass !== "official") {
        throw new Error("verified venue ownership requires an official publisher classification");
      }
      const hasUncertaintyReview = domainReview.uncertainty_reason !== undefined
        || domainReview.uncertainty_reviewed_at !== undefined
        || domainReview.uncertainty_evidence_urls !== undefined;
      if (ownershipStatus === "verified") {
        if (!OWNERSHIP_METHODS.has(domainReview.ownership_method)
            || !validTimestamp(domainReview.ownership_reviewed_at)
            || !Array.isArray(domainReview.ownership_evidence_urls)
            || domainReview.ownership_evidence_urls.length === 0
            || domainReview.ownership_evidence_urls.some((url) => !httpUrl(url))) {
          throw new Error("verified venue ownership lacks durable evidence");
        }
        if (hasUncertaintyReview) {
          throw new Error("verified venue ownership cannot carry uncertainty evidence");
        }
      } else {
        if (domainReview.ownership_method !== undefined
            || domainReview.ownership_reviewed_at !== undefined
            || domainReview.ownership_evidence_urls !== undefined) {
          throw new Error("unverified venue ownership cannot carry verification evidence");
        }
        if (ownershipStatus === "uncertain") {
          if (typeof domainReview.uncertainty_reason !== "string"
              || domainReview.uncertainty_reason.trim().length === 0
              || !validTimestamp(domainReview.uncertainty_reviewed_at)
              || !Array.isArray(domainReview.uncertainty_evidence_urls)
              || domainReview.uncertainty_evidence_urls.length === 0
              || domainReview.uncertainty_evidence_urls.some((url) => !httpUrl(url))) {
            throw new Error("uncertain venue ownership lacks a reviewed reason and evidence");
          }
        } else if (hasUncertaintyReview) {
          throw new Error("rejected venue ownership cannot carry uncertainty evidence");
        }
      }
      reviewedDomains.add(domain);
      publisherClasses[publisherClass] += fixture.candidates.filter((candidate) =>
        registrableDomain(candidate.url) === domain).length;
      ownershipStatuses[ownershipStatus] += 1;
    }
    if (reviewedDomains.size !== candidateDomains.size) {
      throw new Error("adjudication does not cover every candidate publisher domain");
    }
    if (review.official_website_status === "accepted") {
      if (!httpUrl(review.official_website_url)
          || !review.domain_reviews.some((item) => item.ownership_status === "verified"
            && registrableDomain(review.official_website_url) === item.registrable_domain)) {
        throw new Error("accepted official website lacks verified domain ownership");
      }
    } else {
      if (review.official_website_url !== null) {
        throw new Error("non-accepted official website must have a null URL");
      }
      if (review.domain_reviews.some((item) => item.ownership_status === "verified")) {
        throw new Error("verified venue ownership requires an accepted official website");
      }
    }
  }
  return { venues: document.entries.length,
    publisher_domains: Object.values(ownershipStatuses).reduce((sum, count) => sum + count, 0),
    publisher_classes: publisherClasses, ownership_statuses: ownershipStatuses };
}

export function validateWebAdjudicationSet(documents, fixtureDocuments, options = {}) {
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error("web adjudication set is empty");
  }
  const fixtures = Array.isArray(fixtureDocuments) ? fixtureDocuments : [fixtureDocuments];
  const fixtureVenueIds = new Set();
  for (const fixture of fixtures) {
    validateWebFixtureDocument(fixture);
    for (const entry of fixture.entries) {
      if (fixtureVenueIds.has(entry.venue_id)) throw new Error("duplicate venue across web fixtures");
      fixtureVenueIds.add(entry.venue_id);
    }
  }
  const seenVenueIds = new Set();
  const partitions = new Set();
  const totals = { venues: 0, publisher_domains: 0,
    publisher_classes: Object.fromEntries([...PUBLISHER_CLASSES].map((value) => [value, 0])),
    ownership_statuses: Object.fromEntries([...OWNERSHIP_STATUSES].map((value) => [value, 0])) };
  for (const document of documents) {
    const result = validateWebAdjudicationDocument(document, fixtures, options);
    partitions.add(document.partition);
    for (const entry of document.entries) {
      if (seenVenueIds.has(entry.venue_id)) throw new Error("duplicate venue across web adjudications");
      seenVenueIds.add(entry.venue_id);
    }
    totals.venues += result.venues;
    totals.publisher_domains += result.publisher_domains;
    for (const key of Object.keys(totals.publisher_classes)) {
      totals.publisher_classes[key] += result.publisher_classes[key];
    }
    for (const key of Object.keys(totals.ownership_statuses)) {
      totals.ownership_statuses[key] += result.ownership_statuses[key];
    }
  }
  if (seenVenueIds.size !== fixtureVenueIds.size
      || [...fixtureVenueIds].some((venueId) => !seenVenueIds.has(venueId))) {
    throw new Error("web adjudication set does not cover every fixture venue");
  }
  if (partitions.size !== 1) throw new Error("web adjudication set mixes partitions");
  return totals;
}

export function joinWebStressEntries(fixtureDocuments, adjudicationDocuments, predictions = []) {
  const fixtures = Array.isArray(fixtureDocuments) ? fixtureDocuments : [fixtureDocuments];
  const adjudications = Array.isArray(adjudicationDocuments)
    ? adjudicationDocuments : [adjudicationDocuments];
  validateWebAdjudicationSet(adjudications, fixtures);
  const reviews = new Map(adjudications.flatMap((document) => document.entries.map((entry) => [
    entry.venue_id, { ...entry, reviewer: document.reviewer, reviewed_at: document.reviewed_at },
  ])));
  const predicted = new Map(predictions.map((entry) => [entry.venue_id, entry.prediction || entry]));
  return fixtures.flatMap((document) => document.entries.map((entry) => ({ ...entry,
    adjudication: reviews.get(entry.venue_id),
    prediction: predicted.get(entry.venue_id) || { official_website_url: null },
  })));
}

export function verifiedOwnershipPredictions(adjudicationDocuments) {
  const documents = Array.isArray(adjudicationDocuments)
    ? adjudicationDocuments : [adjudicationDocuments];
  return documents.flatMap((document) => document.entries.map((entry) => {
    const verified = entry.domain_reviews.filter((item) => item.ownership_status === "verified");
    const website = entry.official_website_status === "accepted" && verified.some((item) =>
      item.registrable_domain === registrableDomain(entry.official_website_url))
      ? entry.official_website_url : null;
    return { venue_id: entry.venue_id, prediction: { official_website_url: website } };
  }));
}

export function evaluateWebStress(entries) {
  const reviewed = entries.filter((entry) => reviewedAdjudication(entry.adjudication));
  const publications = reviewed.filter((entry) => entry.prediction?.official_website_url);
  const conclusivePublications = publications.filter((entry) =>
    publicationDecision(entry) !== "uncertain");
  const truePublications = conclusivePublications.filter((entry) => publicationDecision(entry) === "verified"
    && sameDomain(entry.prediction.official_website_url, entry.adjudication.official_website_url));
  const falsePublications = conclusivePublications.filter((entry) => !truePublications.includes(entry));
  const officialSites = reviewed.filter((entry) => entry.adjudication.official_website_status === "accepted");
  const recalled = officialSites.filter((entry) => sameDomain(
    entry.prediction?.official_website_url, entry.adjudication.official_website_url));
  const discovered = officialSites.filter((entry) => entry.candidates.some((candidate) =>
    sameDomain(candidate.url, entry.adjudication.official_website_url)));
  return {
    reviewed: reviewed.length,
    publications: publications.length,
    conclusive_publications: conclusivePublications.length,
    unresolved_publications: publications.length - conclusivePublications.length,
    true_publications: truePublications.length,
    false_publications: falsePublications.length,
    false_publication_by_publisher_class: Object.fromEntries([...PUBLISHER_CLASSES].map((value) =>
      [value, falsePublications.filter((entry) => publicationClass(entry) === value).length])),
    official_sites: officialSites.length,
    official_site_precision: ratio(truePublications.length, conclusivePublications.length),
    official_site_precision_wilson_95: wilson(truePublications.length, conclusivePublications.length),
    official_site_recall: ratio(recalled.length, officialSites.length),
    official_site_recall_wilson_95: wilson(recalled.length, officialSites.length),
    search_discovery_recall: ratio(discovered.length, officialSites.length),
    search_discovery_recall_wilson_95: wilson(discovered.length, officialSites.length),
    abstentions: reviewed.length - publications.length,
    coverage: ratio(publications.length, reviewed.length),
    passes_non_vacuity: publications.length > 0,
    passes_precision_target: conclusivePublications.length > 0
      && wilson(truePublications.length, conclusivePublications.length).lower >= 0.95,
  };
}

export function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return { lower: null, upper: null };
  const p = successes / total, z2 = z * z, denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { lower: center - margin, upper: center + margin };
}
function reviewedAdjudication(value) {
  if (value && value.reviewer && validTimestamp(value.reviewed_at)
      && Array.isArray(value.evidence_urls) && value.evidence_urls.length > 0
      && Array.isArray(value.domain_reviews)) return true;
  return value && ["accepted", "no_official_site"].includes(value.official_website_status)
    && value.reviewer && validTimestamp(value.reviewed_at)
    && Array.isArray(value.evidence_urls) && value.evidence_urls.length > 0
    && (value.official_website_status !== "accepted" || httpUrl(value.official_website_url));
}
function publicationDomainReview(entry) {
  const domain = registrableDomain(entry.prediction?.official_website_url);
  return entry.adjudication?.domain_reviews?.find((item) => item.registrable_domain === domain);
}
function publicationDecision(entry) {
  const review = publicationDomainReview(entry);
  if (review) return review.ownership_status;
  return conclusiveReview(entry.adjudication)
    ? (sameDomain(entry.prediction?.official_website_url, entry.adjudication.official_website_url)
      ? "verified" : "rejected") : "uncertain";
}
function publicationClass(entry) { return publicationDomainReview(entry)?.publisher_class || "uncertain"; }
function sameDomain(left, right) { return Boolean(left && right
  && registrableDomain(left) === registrableDomain(right)); }
function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
function httpUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
function validTimestamp(value) { return Number.isFinite(Date.parse(value)); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
