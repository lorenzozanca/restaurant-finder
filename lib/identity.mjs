import { createHash } from "node:crypto";

const IDENTITY_VERSION = 2;
const GENERIC_PREFIXES = new Set([
  "al", "alla", "alle", "all", "il", "lo", "la", "i", "gli", "le",
  "ristorante", "restaurant", "trattoria", "pizzeria", "osteria", "locanda",
  "bar", "pub", "cafe", "caffe", "birreria", "enoteca", "agriturismo",
]);

// Build reversible canonical records. A name resemblance is never sufficient:
// every merge also needs a matching location, address, phone, or website.
export function canonicalizeVenues(records, options = {}) {
  const groups = [];
  const prepared = records.map((input) => {
    const record = cloneRecord(input);
    return { record, sourceRecord: toSourceRecord(record) };
  }).sort((a, b) => a.sourceRecord.source_record_id.localeCompare(b.sourceRecord.source_record_id));
  const reviewPairs = [];
  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex++) {
      const decision = compareVenueRecords(prepared[leftIndex].record, prepared[rightIndex].record);
      if (!decision.review) continue;
      reviewPairs.push({
        status: "review",
        left_source_record_id: prepared[leftIndex].sourceRecord.source_record_id,
        right_source_record_id: prepared[rightIndex].sourceRecord.source_record_id,
        score: decision.score,
        evidence: decision.evidence,
        conflicts: decision.conflicts,
        reason: "name_similarity_requires_independent_corroboration",
      });
    }
  }
  for (const { record, sourceRecord } of prepared) {
    let best = null;

    for (const group of groups) {
      for (const member of group.members) {
        const decision = compareVenueRecords(member.record, record);
        if (decision.merge && (!best || decision.score > best.decision.score)) {
          best = { group, member, decision };
        }
      }
    }

    if (!best) {
      groups.push({ canonical: record, members: [{ record, sourceRecord }], decisions: [] });
      continue;
    }

    best.group.decisions.push({
      status: "merged",
      left_source_record_id: best.member.sourceRecord.source_record_id,
      right_source_record_id: sourceRecord.source_record_id,
      score: best.decision.score,
      evidence: best.decision.evidence,
    });
    best.group.members.push({ record, sourceRecord });
    mergeFacts(best.group.canonical, record);
  }

  const usedIds = new Set();
  const venues = groups.map((group) => finalizeGroup(group, options, usedIds))
    .sort((a, b) => a.canonical_venue_id.localeCompare(b.canonical_venue_id));
  for (const pair of reviewPairs) {
    const owners = venues.filter((venue) => venue.source_records.some((record) =>
      record.source_record_id === pair.left_source_record_id
      || record.source_record_id === pair.right_source_record_id));
    if (owners.length < 2) continue;
    for (const owner of owners) (owner.identity_review ||= []).push(structuredClone(pair));
  }
  return venues;
}

export function compareVenueRecords(left, right) {
  const evidence = [];
  const nameEvidence = bestNameEvidence(left, right);
  if (nameEvidence) evidence.push(nameEvidence);

  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  if (leftPhone && leftPhone === rightPhone) {
    evidence.push({ type: "phone_exact", weight: 45, value: leftPhone });
  }

  const leftUrl = normalizeWebsite(left.website);
  const rightUrl = normalizeWebsite(right.website);
  const leftDomain = websiteDomain(left.website);
  const rightDomain = websiteDomain(right.website);
  if (leftUrl && leftUrl === rightUrl) {
    evidence.push({ type: "website_exact", weight: 45, value: leftUrl });
  } else if (leftDomain && leftDomain === rightDomain) {
    evidence.push({ type: "website_domain", weight: 25, value: leftDomain });
  }

  const leftAddress = normalizeAddress(left.address);
  const rightAddress = normalizeAddress(right.address);
  if (leftAddress && leftAddress === rightAddress) {
    evidence.push({ type: "address_exact", weight: 35, value: leftAddress });
  }

  const leftStreetNumber = normalizedStreetNumber(left);
  const rightStreetNumber = normalizedStreetNumber(right);
  if (leftStreetNumber && leftStreetNumber === rightStreetNumber && leftAddress !== rightAddress) {
    evidence.push({ type: "street_number_exact", weight: 35, value: leftStreetNumber });
  }

  const leftPostcode = normalizePostcode(left.postcode || left.address_components?.postcode
    || left.address_components?.postal_code);
  const rightPostcode = normalizePostcode(right.postcode || right.address_components?.postcode
    || right.address_components?.postal_code);
  if (leftPostcode && leftPostcode === rightPostcode) {
    evidence.push({ type: "postcode_exact", weight: 10, value: leftPostcode });
  }

  const leftPlaceId = providerIdentity(left);
  const rightPlaceId = providerIdentity(right);
  if (leftPlaceId && leftPlaceId === rightPlaceId) {
    evidence.push({ type: "provider_place_id_exact", weight: 50, value: leftPlaceId });
  }

  const distance = distanceMetres(left, right);
  if (distance !== null) {
    if (distance <= 30) evidence.push({ type: "distance", weight: 35, metres: rounded(distance) });
    else if (distance <= 100) evidence.push({ type: "distance", weight: 25, metres: rounded(distance) });
    else if (distance <= 250) evidence.push({ type: "distance", weight: 15, metres: rounded(distance) });
  }

  if (hasIndependentWitness(left, right)
      && evidence.some((item) => !item.type.startsWith("name_") && item.type !== "postcode_exact")) {
    evidence.push({ type: "independent_source_records", weight: 0,
      sources: [recordSource(left), recordSource(right)].sort() });
  }

  const conflicts = [];
  if (distance !== null && distance > 1_000) {
    conflicts.push({ type: "location_conflict", metres: rounded(distance) });
  }
  if (leftPhone && rightPhone && leftPhone !== rightPhone) {
    conflicts.push({ type: "phone_conflict" });
  }
  if (leftPostcode && rightPostcode && leftPostcode !== rightPostcode) {
    conflicts.push({ type: "postcode_conflict", left: leftPostcode, right: rightPostcode });
  }
  const leftLocality = normalizedLocality(left);
  const rightLocality = normalizedLocality(right);
  // A municipality and one of its frazioni can legitimately differ between
  // providers. Matching postcode plus very close coordinates is stronger
  // evidence than that locality-label difference (for example Piavon/Oderzo).
  const sameLocalArea = leftPostcode && leftPostcode === rightPostcode
    && distance !== null && distance <= 250;
  if (leftLocality && rightLocality && leftLocality !== rightLocality && !sameLocalArea) {
    conflicts.push({ type: "municipality_conflict", left: leftLocality, right: rightLocality });
  }
  if (leftStreetNumber && rightStreetNumber && leftStreetNumber !== rightStreetNumber
      && sameNormalizedStreet(left, right)) {
    conflicts.push({ type: "house_number_conflict", left: leftStreetNumber, right: rightStreetNumber });
  }
  const score = evidence.reduce((sum, item) => sum + item.weight, 0);
  const hasName = evidence.some((item) => item.type === "name_exact" || item.type === "name_alias");
  const corroborated = evidence.some((item) => !item.type.startsWith("name_")
    && !["postcode_exact", "independent_source_records"].includes(item.type));
  const strongIdentity = evidence.some((item) => item.type === "phone_exact")
    && evidence.some((item) => item.type === "website_exact" || item.type === "address_exact");
  const merge = conflicts.length === 0 && corroborated
    && ((hasName && score >= 60) || (strongIdentity && score >= 90));

  const review = !merge && hasName && conflicts.length === 0 && score >= 35;
  return { merge, review, score, evidence, conflicts };
}

export function normalizeVenueName(value) {
  return asciiWords(value).join(" ")
    .replace(/\s+(?:s r l|s n c|s a s|s p a|srl|snc|sas|spa|societa cooperativa|cooperativa)$/, "")
    .trim();
}

export function coreVenueName(value) {
  const words = normalizeVenueName(value).split(" ").filter(Boolean);
  while (words.length > 1 && GENERIC_PREFIXES.has(words[0])) words.shift();
  return words.join(" ");
}

function finalizeGroup(group, options, usedIds) {
  const aliases = [...new Set(group.members.flatMap(({ record }) => [record.name, ...(record.aliases || [])])
    .map(cleanDisplayName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "it"));
  const sourceRecords = group.members.map(({ sourceRecord }) => sourceRecord)
    .sort((a, b) => a.source_record_id.localeCompare(b.source_record_id));
  const canonical = group.canonical;
  const baseId = canonicalVenueId(canonical, aliases, options.location);
  let canonicalId = baseId;
  if (usedIds.has(canonicalId)) {
    const suffix = shortHash(sourceRecords.map((item) => item.source_record_id).join("|"));
    canonicalId = `${baseId}-${suffix}`;
  }
  usedIds.add(canonicalId);

  canonical.provenance ||= {};
  canonical.provenance.canonical_venue_id = [{
    source: "identity",
    origin: "derived",
    evidence: group.decisions.length ? ["corroborated_merge"] : ["single_source_record"],
  }];

  const { source, ...result } = canonical;
  return {
    ...result,
    canonical_venue_id: canonicalId,
    identity_version: IDENTITY_VERSION,
    aliases,
    source_records: sourceRecords,
    merge_audit: group.decisions,
    sources: uniqueSources(group.members),
  };
}

function canonicalVenueId(record, aliases, location = "") {
  const place = slug(typeof location === "object" ? location?.municipality : location) || "italy";
  const name = slug(coreVenueName(record.name) || aliases[0]) || "venue";
  return `venue:${place}:${name}`;
}

function toSourceRecord(record) {
  const source = record.source || record.sources?.[0] || "unknown";
  const sourceId = record.osm_id || record.overture_id || record.provider_place_id;
  const locator = sourceId || normalizeWebsite(record.website)
    || normalizePhone(record.phone) || normalizeAddress(record.address)
    || normalizeVenueName(record.name);
  return {
    source_record_id: `${source}:${locator || shortHash(JSON.stringify(record))}`,
    source,
    source_id: sourceId,
    provider_place_id: record.provider_place_id || undefined,
    provider_record_url: record.provider_record_url || undefined,
    name: record.name,
    aliases: Array.isArray(record.aliases) ? record.aliases : undefined,
    type: record.type || undefined,
    address: record.address || undefined,
    address_components: record.address_components || undefined,
    postcode: record.postcode || undefined,
    phone: record.phone || undefined,
    website: record.website || undefined,
    cuisine: record.cuisine || undefined,
    latitude: Number.isFinite(record.latitude) ? record.latitude : undefined,
    longitude: Number.isFinite(record.longitude) ? record.longitude : undefined,
    provenance: record.provenance || undefined,
  };
}

function mergeFacts(target, source) {
  mergeProvenance(target, source, "name");
  if (source.website && (!target.website || websiteQuality(source.website) > websiteQuality(target.website))) {
    copyField(target, source, "website");
  }
  for (const field of ["phone", "address", "cuisine", "osm_id", "overture_id",
    "provider_place_id", "provider_record_url", "postcode", "address_components"]) {
    if (source[field] && !target[field]) copyField(target, source, field);
  }
  if (Number.isFinite(source.latitude) && Number.isFinite(source.longitude)
      && (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude))) {
    copyField(target, source, "latitude");
    copyField(target, source, "longitude");
  }
  if (source.type && target.type === "restaurant" && source.type !== "restaurant") {
    copyField(target, source, "type");
  }
}

function copyField(target, source, field) {
  target[field] = source[field];
  target.provenance ||= {};
  target.provenance[field] = [...(source.provenance?.[field] || [])];
}

function mergeProvenance(target, source, field) {
  const combined = [...(target.provenance?.[field] || []), ...(source.provenance?.[field] || [])];
  const seen = new Set();
  target.provenance ||= {};
  target.provenance[field] = combined.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSources(members) {
  const values = members.flatMap(({ record }) => [record.source, ...(record.sources || [])]);
  return [...new Set(values.filter(Boolean))].sort();
}

function cloneRecord(record) {
  return structuredClone(record);
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("39") && digits.length > 10 ? digits.slice(2) : digits;
}

function normalizeAddress(value) {
  return asciiWords(value).join(" ");
}

function bestNameEvidence(left, right) {
  const leftNames = [left.name, ...(left.aliases || [])];
  const rightNames = [right.name, ...(right.aliases || [])];
  let alias = null;
  for (const leftName of leftNames) {
    for (const rightName of rightNames) {
      const normalizedLeft = normalizeVenueName(leftName);
      const normalizedRight = normalizeVenueName(rightName);
      if (normalizedLeft && normalizedLeft === normalizedRight) {
        return { type: "name_exact", weight: 50, value: normalizedLeft,
          aliases: [cleanDisplayName(leftName), cleanDisplayName(rightName)] };
      }
      const coreLeft = coreVenueName(leftName);
      const coreRight = coreVenueName(rightName);
      if (!alias && coreLeft && coreLeft === coreRight) {
        alias = { type: "name_alias", weight: 35, value: coreLeft,
          aliases: [cleanDisplayName(leftName), cleanDisplayName(rightName)] };
      } else if (!alias && coreLeft.length >= 4 && coreRight.length >= 4
          && (coreLeft.includes(coreRight) || coreRight.includes(coreLeft))) {
        alias = { type: "name_alias", weight: 25,
          value: coreLeft.length <= coreRight.length ? coreLeft : coreRight,
          aliases: [cleanDisplayName(leftName), cleanDisplayName(rightName)] };
      }
    }
  }
  return alias;
}

function normalizePostcode(value) { return String(value || "").replace(/\D/g, ""); }
function providerIdentity(record) {
  const id = String(record.provider_place_id || "").trim();
  return id.toLowerCase();
}
function normalizedLocality(record) {
  return normalizeVenueName(record.address_components?.locality
    || record.address_components?.municipality || "");
}
function normalizedStreetNumber(record) {
  const components = record.address_components || {};
  const street = normalizeAddress(components.street || components.road);
  const number = normalizeAddress(components.house_number || components.housenumber);
  if (street && number) return `${street} ${number}`;
  const firstAddressLine = String(record.address || "").split(",")[0];
  const match = firstAddressLine.match(/^(.*?)[,\s]+(\d+[a-z]?(?:\s*[/\-]\s*\d+[a-z]?)?)$/i);
  return match ? `${normalizeAddress(match[1])} ${normalizeAddress(match[2])}`.trim() : "";
}
function sameNormalizedStreet(left, right) {
  const street = (record) => normalizeAddress(record.address_components?.street
    || record.address_components?.road || String(record.address || "").split(",")[0].replace(/\s+\d+[a-z/\-]*$/i, ""));
  const leftStreet = street(left);
  const rightStreet = street(right);
  return Boolean(leftStreet && leftStreet === rightStreet);
}
function recordSource(record) { return String(record.source || record.sources?.[0] || "unknown"); }
function hasIndependentWitness(left, right) {
  const leftSource = recordSource(left);
  const rightSource = recordSource(right);
  if (leftSource === rightSource) return false;
  return [leftSource, rightSource].some((source) =>
    ["nominatim", "overture_places", "paginegialle", "directory_lead"].includes(source));
}

function normalizeWebsite(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return "";
  }
}

function websiteDomain(value) {
  return normalizeWebsite(value).split("/")[0] || "";
}

function websiteQuality(value) {
  const domain = websiteDomain(value);
  if (!domain) return 0;
  if (/paginegialle|thefork|facebook|instagram|tripadvisor|restaurantguru|sluurpy/.test(domain)) return 1;
  return String(value).startsWith("https://") ? 4 : 3;
}

function distanceMetres(left, right) {
  if (![left.latitude, left.longitude, right.latitude, right.longitude].every(Number.isFinite)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function asciiWords(value) {
  return String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function cleanDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function slug(value) {
  return asciiWords(value).join("-").slice(0, 64);
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}
