import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { registrableDomain } from "./publisher-ownership.mjs";

export const EVIDENCE_SCHEMA_VERSION = 4;
export const EVIDENCE_VERSION = 1;

const DAY = 86_400_000;
const DEFAULT_TTLS = Object.freeze({ website: 30 * DAY, resource: 14 * DAY });
const DEFAULT_RETRY = Object.freeze({
  not_observed: 7 * DAY,
  temporarily_unreachable: DAY,
  review: 7 * DAY,
  rejected: 30 * DAY,
});

export class EvidenceStore {
  constructor(path, options = {}) {
    if (!path) throw new TypeError("evidence store path is required");
    this.path = path;
    this.clock = options.clock || (() => new Date());
    this.ttls = { ...DEFAULT_TTLS, ...(options.ttls || {}) };
    this.retryDelays = { ...DEFAULT_RETRY, ...(options.retryDelays || {}) };
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
    this.#migrate();
  }

  close() { this.db.close(); }

  metadata() {
    return {
      path: this.path,
      schema_version: Number(this.#metadata("schema_version")),
      evidence_version: EVIDENCE_VERSION,
    };
  }

  transaction(callback) { return this.#transaction(callback); }

  exportLegacyScan(options = {}) {
    const exportedAt = iso(options.exportedAt || this.clock());
    const municipalityLabel = String(options.municipality || "").trim();
    const municipality = normalize(municipalityLabel);
    const venues = this.db.prepare(`SELECT * FROM venues
      WHERE lifecycle_status = 'active' AND (? = '' OR municipality = ?)
      ORDER BY display_name COLLATE NOCASE, venue_id`).all(municipality, municipality);
    const restaurants = venues.map((venue) => {
      const facts = this.db.prepare(`SELECT kind, fact_key, payload_json FROM facts
        WHERE venue_id = ? AND decision_status = 'accepted' AND lifecycle_status = 'active'
        ORDER BY kind, fact_key`).all(venue.venue_id);
      const website = facts.find((fact) => fact.kind === "website"
        && this.hasActivePublisherAttestation(venue.venue_id, fact.fact_key, { at: exportedAt }));
      return {
        name: venue.display_name,
        canonical_venue_id: venue.venue_id,
        ...(website ? { website: website.fact_key } : {}),
        resources: facts.filter((fact) => fact.kind === "resource" && website)
          .map((fact) => ({ ...parseJson(fact.payload_json), url: fact.fact_key })),
      };
    });
    return {
      schema_version: 1,
      location: municipalityLabel || "Durable venue store",
      scanned_at: exportedAt,
      sources_used: ["sqlite_evidence_store"],
      total: restaurants.length,
      with_resources: restaurants.filter((venue) => venue.resources.length > 0).length,
      restaurants,
    };
  }

  rememberVenue(venue, options = {}) {
    requireVenue(venue);
    const checkedAt = iso(options.checkedAt || this.clock());
    const municipality = normalize(options.municipality || options.location?.municipality);
    const existingId = this.#resolveVenueId(venue, municipality);
    const venueId = existingId || venue.canonical_venue_id;
    this.#transaction(() => {
      this.db.prepare(`
        INSERT INTO venues (venue_id, display_name, municipality, lifecycle_status, first_seen, last_seen)
        VALUES (?, ?, ?, 'active', ?, ?)
        ON CONFLICT(venue_id) DO UPDATE SET
          display_name = excluded.display_name,
          municipality = CASE WHEN excluded.municipality <> '' THEN excluded.municipality ELSE venues.municipality END,
          last_seen = excluded.last_seen
      `).run(venueId, venue.name, municipality, checkedAt, checkedAt);
      this.#rememberIdentifier(venue.canonical_venue_id, venueId, "canonical_venue_id", checkedAt);
      for (const source of venue.source_records || []) {
        if (!source?.source_record_id) continue;
        this.db.prepare(`
          INSERT INTO source_records (source_record_id, venue_id, source, payload_json, first_seen, last_seen)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_record_id) DO UPDATE SET
            venue_id = excluded.venue_id, payload_json = excluded.payload_json, last_seen = excluded.last_seen
        `).run(source.source_record_id, venueId, source.source || "unknown", json(source), checkedAt, checkedAt);
      }
      for (const alias of unique([venue.name, ...(venue.aliases || [])])) {
        this.db.prepare(`
          INSERT INTO venue_aliases (venue_id, alias, normalized_alias, first_seen, last_seen)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(venue_id, normalized_alias) DO UPDATE SET alias = excluded.alias, last_seen = excluded.last_seen
        `).run(venueId, alias, normalize(alias), checkedAt, checkedAt);
      }
      for (const edge of venue.merge_audit || []) this.#rememberMergeEdge(venueId, edge, checkedAt);
    });
    return venueId;
  }

  findReusableEvidence(venue, options = {}) {
    requireVenue(venue);
    const at = iso(options.at || this.clock());
    const venueId = this.#resolveVenueId(venue, normalize(options.municipality || options.location?.municipality));
    if (!venueId) return null;
    const durableVenue = this.db.prepare("SELECT * FROM venues WHERE venue_id = ?").get(venueId);
    if (!durableVenue || durableVenue.lifecycle_status === "closed") return null;
    const rows = this.db.prepare(`
      SELECT * FROM facts
      WHERE venue_id = ? AND decision_status = 'accepted' AND lifecycle_status = 'active'
      ORDER BY kind, last_seen DESC, fact_id DESC
    `).all(venueId);
    const websites = rows.filter((row) => row.kind === "website"
      && this.hasActivePublisherAttestation(venueId, row.fact_key, { at }));
    const resources = websites.length ? rows.filter((row) => row.kind === "resource") : [];
    const website = websites[0];
    if (!website && resources.length === 0) return null;
    const allRows = [website, ...resources].filter(Boolean);
    const dueForRevalidation = allRows.some((row) => at >= row.valid_until || at >= row.retry_after);
    const stateFor = (row) => publicFactState(row, at);
    const websitePayload = website ? parseJson(website.payload_json) : {};
    const resourcePayloads = resources.map((row) => ({
      ...parseJson(row.payload_json),
      evidence_state: stateFor(row),
    }));
    return {
      venue_id: venueId,
      matched_by: venueId === venue.canonical_venue_id ? "canonical_venue_id" : "durable_identity",
      due_for_revalidation: dueForRevalidation,
      website: website?.fact_key,
      website_kind: website ? "official" : undefined,
      website_confidence: websitePayload.website_confidence,
      website_decision: websitePayload.website_decision,
      website_provenance: websitePayload.website_provenance,
      resources: resourcePayloads,
      resource_decisions: websitePayload.resource_decisions || [],
      enrichment_run: websitePayload.enrichment_run,
      evidence_state: {
        source: "sqlite_last_known_good",
        venue_id: venueId,
        website: website ? stateFor(website) : undefined,
        resources: resources.map(stateFor),
        due_for_revalidation: dueForRevalidation,
      },
    };
  }

  recordEnrichment(venue, enrichment, options = {}) {
    const checkedAt = iso(options.checkedAt || this.clock());
    const venueId = this.rememberVenue(venue, { ...options, checkedAt });
    this.#transaction(() => {
      this.#recordSearchAttempts(venueId, enrichment?.enrichment_run, checkedAt);
      if (enrichment?.website && enrichment.website_decision?.status === "accepted") {
        this.#retireOtherAcceptedFacts(venueId, "website", enrichment.website, checkedAt,
          "replaced_by_positive_accepted_evidence");
        this.#upsertAcceptedFact(venueId, "website", enrichment.website, {
          website_confidence: enrichment.website_confidence,
          website_decision: enrichment.website_decision,
          website_provenance: enrichment.website_provenance,
          resource_decisions: enrichment.resource_decisions || [],
          enrichment_run: enrichment.enrichment_run,
        }, checkedAt);
      } else {
        const outcome = inferCheckOutcome(enrichment?.enrichment_run);
        this.#recordCheckOutcomeById(venueId, { kind: "website", outcome, checkedAt,
          evidence: [enrichment?.enrichment_run?.resolver_stop_reason || outcome] });
      }
      for (const resource of enrichment?.resources || []) {
        this.#upsertAcceptedFact(venueId, "resource", resource.url, resource, checkedAt);
      }
      for (const decision of enrichment?.resource_decisions || []) {
        if (decision.status === "accepted") continue;
        this.#upsertDecision(venueId, "resource", decision.final_url || decision.requested_url,
          decision.status, decision, checkedAt);
      }
    });
    return this.findReusableEvidence(venue, { ...options, at: checkedAt });
  }

  recordCheckOutcome(venue, observation, options = {}) {
    const checkedAt = iso(observation.checkedAt || options.checkedAt || this.clock());
    const venueId = this.rememberVenue(venue, { ...options, checkedAt });
    this.#transaction(() => this.#recordCheckOutcomeById(venueId, { ...observation, checkedAt }));
  }

  confirmClosure(venue, observation = {}, options = {}) {
    const checkedAt = iso(observation.checkedAt || options.checkedAt || this.clock());
    const evidence = observation.evidence || [];
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error("confirmed closure requires positive evidence");
    }
    const venueId = this.rememberVenue(venue, { ...options, checkedAt });
    this.#transaction(() => {
      this.db.prepare(`UPDATE venues SET lifecycle_status = 'closed', status_reason = ?,
        status_checked_at = ?, last_seen = ? WHERE venue_id = ?`)
        .run(observation.reason || "confirmed_closure", checkedAt, checkedAt, venueId);
      const active = this.db.prepare("SELECT fact_id FROM facts WHERE venue_id = ? AND lifecycle_status = 'active'")
        .all(venueId);
      this.db.prepare(`UPDATE facts SET lifecycle_status = 'retired', retirement_reason = ?,
        last_checked = ?, retry_after = ? WHERE venue_id = ? AND lifecycle_status = 'active'`)
        .run(observation.reason || "confirmed_closure", checkedAt, checkedAt, venueId);
      for (const row of active) this.#event(row.fact_id, "retired", checkedAt,
        observation.reason || "confirmed_closure", evidence);
    });
  }

  auditFacts(venue) {
    const venueId = typeof venue === "string" ? venue : this.#resolveVenueId(venue, "");
    if (!venueId) return [];
    return this.db.prepare(`SELECT fact_id, kind, fact_key, decision_status, lifecycle_status,
      first_seen, last_seen, last_checked, valid_until, retry_after, last_check_outcome,
      retirement_reason FROM facts WHERE venue_id = ? ORDER BY fact_id`).all(venueId);
  }

  recordPublisherAttestation(venue, attestation, options = {}) {
    const venueId = typeof venue === "string" ? venue : venue?.canonical_venue_id;
    if (!venueId || (attestation?.venue_id && attestation.venue_id !== venueId)) {
      throw new Error("publisher attestation venue mismatch");
    }
    if (!this.db.prepare("SELECT 1 FROM venues WHERE venue_id = ?").get(venueId)) {
      throw new Error(`publisher attestation venue ${venueId} does not exist`);
    }
    const normalized = validatePublisherAttestationWrite(attestation, venueId, this.clock, options);
    return this.#transaction(() => {
      const existing = this.db.prepare(`SELECT * FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(venueId, normalized.publisher_domain);
      const snapshot = JSON.stringify(normalized);
      if (existing && attestationSnapshot(existing) === snapshot) return publicAttestation(existing);
      const now = iso(options.recordedAt || this.clock());
      this.db.prepare(`INSERT INTO publisher_attestations
        (venue_id, publisher_domain, decision_status, method, attested_website,
         evidence_urls_json, reviewer, reviewed_at, expires_at, notes, source_kind,
         source_fingerprint, lifecycle_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(venue_id, publisher_domain) DO UPDATE SET
          decision_status = excluded.decision_status, method = excluded.method,
          attested_website = excluded.attested_website,
          evidence_urls_json = excluded.evidence_urls_json, reviewer = excluded.reviewer,
          reviewed_at = excluded.reviewed_at, expires_at = excluded.expires_at,
          notes = excluded.notes, source_kind = excluded.source_kind,
          source_fingerprint = excluded.source_fingerprint, lifecycle_status = 'active',
          updated_at = excluded.updated_at`).run(
        venueId, normalized.publisher_domain, normalized.status, normalized.method,
        normalized.website_url, JSON.stringify(normalized.evidence_urls), normalized.reviewer,
        normalized.reviewed_at, normalized.expires_at, normalized.notes || null,
        normalized.source_kind, normalized.source_fingerprint || null, "active", now, now);
      const row = this.db.prepare(`SELECT * FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(venueId, normalized.publisher_domain);
      this.#publisherEvent(row.attestation_id, existing ? "replaced" : "created", now,
        normalized.reviewer, options.reason || "reviewed_publisher_ownership", publicAttestation(row));
      return publicAttestation(row);
    });
  }

  importPublisherReviews(selection, options = {}) {
    if (!selection || !Array.isArray(selection.candidates)) throw new Error("invalid reviewed selection");
    const fingerprint = String(options.selectionFingerprint
      || selection.candidate_fingerprint_sha256 || selection.selection_fingerprint_sha256
      || selection.selection_id || "").trim();
    if (!fingerprint) throw new Error("reviewed selection fingerprint is required");
    let imported = 0;
    let unchanged = 0;
    for (const row of selection.candidates) {
      const review = row.review;
      if (review?.official_website_status !== "accepted") continue;
      const before = this.db.prepare(`SELECT updated_at FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(row.venue_id,
        registrableDomain(review.official_website_url));
      this.recordPublisherAttestation(row.venue_id, {
        status: "verified", method: "manual_first_party_review", venue_id: row.venue_id,
        website_url: review.official_website_url, evidence_urls: review.evidence_urls,
        reviewed_at: review.reviewed_at, expires_at: options.expiresAt
          || plus(review.reviewed_at, options.ttl ?? 365 * DAY), reviewer: review.reviewer,
        notes: review.notes, source_kind: "human_review", source_fingerprint: fingerprint,
      }, { reason: `import:${selection.selection_id || fingerprint}` });
      const after = this.db.prepare(`SELECT updated_at FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(row.venue_id,
        registrableDomain(review.official_website_url));
      if (before?.updated_at === after?.updated_at) unchanged++; else imported++;
    }
    return { imported, unchanged, accepted_reviews: imported + unchanged,
      selection_id: selection.selection_id || null, selection_fingerprint: fingerprint };
  }

  publisherOwnershipForVenue(venue, options = {}) {
    const venueId = typeof venue === "string" ? venue : this.#resolveVenueId(venue, "");
    if (!venueId) return [];
    const at = iso(options.at || this.clock());
    return this.db.prepare(`SELECT * FROM publisher_attestations
      WHERE venue_id = ? AND decision_status = 'verified' AND lifecycle_status = 'active'
        AND reviewed_at <= ? AND expires_at > ? ORDER BY publisher_domain`).all(venueId, at, at)
      .map(publicAttestation);
  }

  hasActivePublisherAttestation(venueId, websiteUrl, options = {}) {
    const domain = registrableDomain(websiteUrl);
    if (!domain) return false;
    return this.publisherOwnershipForVenue(venueId, options)
      .some((row) => row.publisher_domain === domain);
  }

  listPublisherAttestations(options = {}) {
    const venueId = String(options.venueId || "").trim();
    const limit = boundedLimit(options.limit, 100);
    return this.db.prepare(`SELECT * FROM publisher_attestations
      WHERE (? = '' OR venue_id = ?) ORDER BY updated_at DESC, attestation_id DESC LIMIT ?`)
      .all(venueId, venueId, limit).map(publicAttestation);
  }

  listUnattestedCandidates(options = {}) {
    const at = iso(options.at || this.clock());
    const limit = boundedLimit(options.limit, 100);
    return this.db.prepare(`SELECT v.venue_id, v.display_name, v.municipality
      FROM venues v WHERE v.lifecycle_status = 'active' AND NOT EXISTS (
        SELECT 1 FROM publisher_attestations p WHERE p.venue_id = v.venue_id
          AND p.decision_status = 'verified' AND p.lifecycle_status = 'active'
          AND p.reviewed_at <= ? AND p.expires_at > ?)
      ORDER BY v.venue_id LIMIT ?`).all(at, at, limit);
  }

  // One evidence-backed review unit for the ownership review queue. Read-only:
  // the first venue/domain candidate without a current decision (or the
  // requested venue for deep-linking), plus the source evidence and crawl
  // facts a reviewer needs to decide. Never publishes; decisions are recorded
  // separately via recordPublisherAttestation. A rejection suppresses only
  // that candidate domain, leaving other candidates for the venue reviewable.
  nextReviewCandidate(options = {}) {
    const at = iso(options.at || this.clock());
    const requested = String(options.venueId || "").trim();
    const requestedDomain = String(options.candidateDomain || "").trim().toLowerCase();
    const excluded = String(options.excludeVenueId || "").trim();
    const afterVenue = String(options.afterVenueId || "").trim();
    const afterDomain = String(options.afterDomain || "").trim();
    const rawCandidates = this.db.prepare(`SELECT v.venue_id, v.display_name, v.municipality,
        c.candidate_url, c.candidate_origin
      FROM venues v JOIN (
        SELECT venue_id, json_extract(payload_json, '$.website') AS candidate_url,
          'source:' || source AS candidate_origin
        FROM source_records
        WHERE json_type(payload_json, '$.website') = 'text'
          AND trim(json_extract(payload_json, '$.website')) != ''
        UNION ALL
        SELECT venue_id, fact_key AS candidate_url,
          'fact:' || decision_status AS candidate_origin
        FROM facts WHERE kind = 'website' AND lifecycle_status = 'active'
      ) c ON c.venue_id = v.venue_id
      WHERE v.lifecycle_status = 'active' AND (? = '' OR v.venue_id = ?)
        AND v.venue_id != ?
      ORDER BY v.venue_id, c.candidate_url, c.candidate_origin`)
      .all(requested, requested, excluded);
    const decisions = this.db.prepare(`SELECT venue_id, publisher_domain, decision_status,
        method, attested_website, reviewer, reviewed_at, expires_at
      FROM publisher_attestations WHERE lifecycle_status = 'active'
        AND reviewed_at <= ? AND expires_at > ?`).all(at, at);
    const verifiedVenues = new Set(decisions.filter((row) => row.decision_status === "verified")
      .map((row) => row.venue_id));
    const decidedDomains = new Map(decisions.map((row) => [`${row.venue_id}\n${row.publisher_domain}`, row]));
    const candidates = new Map();
    for (const row of rawCandidates) {
      const url = reviewCandidateUrl(row.candidate_url);
      const domain = registrableDomain(url);
      if (!url || !domain) continue;
      const key = `${row.venue_id}\n${domain}`;
      if (!candidates.has(key)) candidates.set(key, {
        venue_id: row.venue_id, display_name: row.display_name, municipality: row.municipality,
        candidate_url: url, candidate_domain: domain,
        candidate_origins: [], existing_decision: decidedDomains.get(key) || null,
      });
      const item = candidates.get(key);
      if (!item.candidate_origins.includes(row.candidate_origin)) {
        item.candidate_origins.push(row.candidate_origin);
      }
    }
    const allCandidates = [...candidates.values()]
      .sort((left, right) => lexicalCompare(left.venue_id, right.venue_id)
        || lexicalCompare(left.candidate_domain, right.candidate_domain));
    const eligible = allCandidates.filter((item) => {
      if (requestedDomain && item.candidate_domain !== requestedDomain) return false;
      if (requested) return true;
      if (verifiedVenues.has(item.venue_id) || item.existing_decision) return false;
      if (!afterVenue) return true;
      return item.venue_id > afterVenue
        || (item.venue_id === afterVenue && item.candidate_domain > afterDomain);
    });
    const candidate = eligible[0];
    if (!candidate) return null;
    const venue = candidate;
    const sources = this.db.prepare(`SELECT source, payload_json FROM source_records
      WHERE venue_id = ? ORDER BY source, source_record_id`).all(venue.venue_id)
      .map((row) => pickSourceEvidence(row.source, parseJson(row.payload_json)));
    const facts = this.db.prepare(`SELECT kind, fact_key, decision_status, last_seen,
      last_check_outcome FROM facts WHERE venue_id = ? AND lifecycle_status = 'active'
      ORDER BY kind, fact_key`).all(venue.venue_id)
      .map((row) => ({
        kind: row.kind, url: row.fact_key, decision_status: row.decision_status,
        last_seen: row.last_seen, last_check_outcome: row.last_check_outcome,
      }));
    const remaining = allCandidates.filter((item) =>
      !verifiedVenues.has(item.venue_id) && !item.existing_decision).length;
    return {
      venue_id: venue.venue_id, display_name: venue.display_name,
      municipality: venue.municipality,
      candidate_url: candidate.candidate_url, candidate_domain: candidate.candidate_domain,
      candidate_origins: candidate.candidate_origins,
      existing_decision: candidate.existing_decision,
      already_attested: verifiedVenues.has(venue.venue_id),
      sources, facts, queue_remaining: remaining,
    };
  }

  revokePublisherAttestation(venueId, domainOrUrl, options = {}) {
    const domain = registrableDomain(domainOrUrl.includes?.("://") ? domainOrUrl : `https://${domainOrUrl}`);
    const reviewer = String(options.reviewer || "").trim();
    const reason = String(options.reason || "").trim();
    if (!venueId || !domain || !reviewer || !reason) {
      throw new Error("revocation requires venue, valid domain, reviewer, and reason");
    }
    return this.#transaction(() => {
      const row = this.db.prepare(`SELECT * FROM publisher_attestations
        WHERE venue_id = ? AND publisher_domain = ?`).get(venueId, domain);
      if (!row) throw new Error(`publisher attestation not found for ${venueId} ${domain}`);
      if (row.lifecycle_status === "revoked") return publicAttestation(row);
      const now = iso(options.occurredAt || this.clock());
      this.db.prepare(`UPDATE publisher_attestations SET lifecycle_status = 'revoked', updated_at = ?
        WHERE attestation_id = ?`).run(now, row.attestation_id);
      const updated = this.db.prepare("SELECT * FROM publisher_attestations WHERE attestation_id = ?")
        .get(row.attestation_id);
      this.#publisherEvent(row.attestation_id, "revoked", now, reviewer, reason,
        publicAttestation(updated));
      return publicAttestation(updated);
    });
  }

  publisherAttestationHistory(venueId, domainOrUrl = "") {
    const domain = domainOrUrl
      ? registrableDomain(domainOrUrl.includes?.("://") ? domainOrUrl : `https://${domainOrUrl}`) : "";
    return this.db.prepare(`SELECT e.event_id, e.attestation_id, e.event_type, e.occurred_at,
      e.actor, e.reason, e.snapshot_json FROM publisher_attestation_events e
      JOIN publisher_attestations p USING (attestation_id)
      WHERE p.venue_id = ? AND (? = '' OR p.publisher_domain = ?)
      ORDER BY e.event_id`).all(venueId, domain, domain)
      .map((row) => ({ ...row, snapshot: parseJson(row.snapshot_json), snapshot_json: undefined }));
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS venues (
        venue_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, municipality TEXT NOT NULL DEFAULT '',
        lifecycle_status TEXT NOT NULL DEFAULT 'active', status_reason TEXT, status_checked_at TEXT,
        first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS venue_identifiers (
        identifier TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(venue_id),
        identifier_type TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS venue_aliases (
        venue_id TEXT NOT NULL REFERENCES venues(venue_id), alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        PRIMARY KEY (venue_id, normalized_alias)
      );
      CREATE INDEX IF NOT EXISTS venue_alias_lookup ON venue_aliases(normalized_alias);
      CREATE TABLE IF NOT EXISTS source_records (
        source_record_id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(venue_id),
        source TEXT NOT NULL, payload_json TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS merge_edges (
        venue_id TEXT NOT NULL REFERENCES venues(venue_id), left_source_record_id TEXT NOT NULL,
        right_source_record_id TEXT NOT NULL, status TEXT NOT NULL, evidence_json TEXT NOT NULL,
        first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        PRIMARY KEY (venue_id, left_source_record_id, right_source_record_id)
      );
      CREATE TABLE IF NOT EXISTS facts (
        fact_id INTEGER PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(venue_id),
        kind TEXT NOT NULL, fact_key TEXT NOT NULL, decision_status TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL DEFAULT 'active', payload_json TEXT NOT NULL,
        evidence_version INTEGER NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        last_checked TEXT NOT NULL, valid_until TEXT NOT NULL, retry_after TEXT NOT NULL,
        last_check_outcome TEXT NOT NULL, retirement_reason TEXT,
        UNIQUE (venue_id, kind, fact_key)
      );
      CREATE INDEX IF NOT EXISTS active_fact_lookup ON facts(venue_id, kind, lifecycle_status);
      CREATE TABLE IF NOT EXISTS fact_events (
        event_id INTEGER PRIMARY KEY, fact_id INTEGER NOT NULL REFERENCES facts(fact_id),
        event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, reason TEXT NOT NULL,
        evidence_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS search_attempts (
        attempt_id INTEGER PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(venue_id),
        checked_at TEXT NOT NULL, purpose TEXT NOT NULL, query TEXT NOT NULL, provider TEXT,
        http_status INTEGER, outcome TEXT NOT NULL, latency_ms INTEGER, cache_status TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE VIEW IF NOT EXISTS provider_health AS
        SELECT provider, outcome, http_status, COUNT(*) AS attempt_count,
          MAX(checked_at) AS last_checked
        FROM search_attempts GROUP BY provider, outcome, http_status;
      CREATE TABLE IF NOT EXISTS run_manifests (
        run_id TEXT PRIMARY KEY, status TEXT NOT NULL, code_version TEXT NOT NULL,
        scoring_version TEXT NOT NULL, source_health_json TEXT NOT NULL,
        configuration_json TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS enrichment_jobs (
        job_id INTEGER PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
        venue_id TEXT NOT NULL REFERENCES venues(venue_id), run_id TEXT REFERENCES run_manifests(run_id),
        stage TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT,
        provider TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '',
        attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
        next_attempt_at TEXT NOT NULL, lease_owner TEXT, lease_token TEXT, lease_expires_at TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0, cancel_reason TEXT,
        last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
        CHECK (status IN ('queued', 'leased', 'retry_scheduled', 'succeeded', 'cancelled', 'dead_letter')),
        CHECK (attempt_count >= 0), CHECK (max_attempts >= 1)
      );
      CREATE INDEX IF NOT EXISTS enrichment_job_claim ON enrichment_jobs
        (status, next_attempt_at, priority DESC, job_id);
      CREATE INDEX IF NOT EXISTS enrichment_job_lease ON enrichment_jobs(status, lease_expires_at);
      CREATE TABLE IF NOT EXISTS enrichment_attempts (
        attempt_id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES enrichment_jobs(job_id),
        attempt_number INTEGER NOT NULL, worker_id TEXT NOT NULL, lease_token TEXT NOT NULL,
        status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
        error TEXT, result_json TEXT,
        UNIQUE (job_id, attempt_number)
      );
      CREATE TABLE IF NOT EXISTS request_budgets (
        scope TEXT NOT NULL, scope_key TEXT NOT NULL, period TEXT NOT NULL,
        request_limit INTEGER NOT NULL, requests_used INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL, PRIMARY KEY (scope, scope_key, period),
        CHECK (request_limit >= 0), CHECK (requests_used >= 0)
      );
      CREATE TABLE IF NOT EXISTS provider_circuits (
        provider TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'closed',
        consecutive_failures INTEGER NOT NULL DEFAULT 0, failure_threshold INTEGER NOT NULL,
        open_until TEXT, updated_at TEXT NOT NULL,
        CHECK (state IN ('closed', 'open')), CHECK (consecutive_failures >= 0)
      );
      CREATE TABLE IF NOT EXISTS quota_pauses (
        scope TEXT NOT NULL, scope_key TEXT NOT NULL, reason TEXT NOT NULL,
        paused_at TEXT NOT NULL, resume_after TEXT, details_json TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY (scope, scope_key),
        CHECK (scope IN ('global', 'provider', 'domain'))
      );
      CREATE TABLE IF NOT EXISTS publisher_attestations (
        attestation_id INTEGER PRIMARY KEY,
        venue_id TEXT NOT NULL REFERENCES venues(venue_id),
        publisher_domain TEXT NOT NULL,
        decision_status TEXT NOT NULL,
        method TEXT NOT NULL,
        attested_website TEXT NOT NULL,
        evidence_urls_json TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        notes TEXT,
        source_kind TEXT NOT NULL,
        source_fingerprint TEXT,
        lifecycle_status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (venue_id, publisher_domain),
        CHECK (decision_status IN ('verified', 'rejected')),
        CHECK (lifecycle_status IN ('active', 'revoked'))
      );
      CREATE INDEX IF NOT EXISTS active_publisher_attestation
        ON publisher_attestations(venue_id, publisher_domain, decision_status, lifecycle_status, expires_at);
      CREATE TABLE IF NOT EXISTS publisher_attestation_events (
        event_id INTEGER PRIMARY KEY,
        attestation_id INTEGER NOT NULL REFERENCES publisher_attestations(attestation_id),
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
    `);
    const current = Number(this.#metadata("schema_version") || 0);
    if (current > EVIDENCE_SCHEMA_VERSION) {
      throw new Error(`evidence schema ${current} is newer than supported schema ${EVIDENCE_SCHEMA_VERSION}`);
    }
    this.db.prepare(`INSERT INTO metadata (key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(EVIDENCE_SCHEMA_VERSION));
    this.db.prepare(`INSERT INTO metadata (key, value) VALUES ('evidence_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(EVIDENCE_VERSION));
  }

  #metadata(key) { return this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key)?.value; }

  #resolveVenueId(venue, municipality) {
    if (!venue) return null;
    const canonical = venue.canonical_venue_id;
    if (canonical) {
      const direct = this.db.prepare("SELECT venue_id FROM venue_identifiers WHERE identifier = ?").get(canonical);
      if (direct) return direct.venue_id;
      if (this.db.prepare("SELECT 1 FROM venues WHERE venue_id = ?").get(canonical)) return canonical;
    }
    for (const source of venue.source_records || []) {
      const match = source?.source_record_id
        ? this.db.prepare("SELECT venue_id FROM source_records WHERE source_record_id = ?").get(source.source_record_id)
        : null;
      if (match) return match.venue_id;
    }
    return null;
  }

  #rememberIdentifier(identifier, venueId, type, checkedAt) {
    if (!identifier) return;
    this.db.prepare(`INSERT INTO venue_identifiers
      (identifier, venue_id, identifier_type, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(identifier) DO UPDATE SET venue_id = excluded.venue_id, last_seen = excluded.last_seen`)
      .run(identifier, venueId, type, checkedAt, checkedAt);
  }

  #rememberMergeEdge(venueId, edge, checkedAt) {
    if (!edge?.left_source_record_id || !edge?.right_source_record_id) return;
    this.db.prepare(`INSERT INTO merge_edges
      (venue_id, left_source_record_id, right_source_record_id, status, evidence_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, left_source_record_id, right_source_record_id) DO UPDATE SET
        status = excluded.status, evidence_json = excluded.evidence_json, last_seen = excluded.last_seen`)
      .run(venueId, edge.left_source_record_id, edge.right_source_record_id,
        edge.status || "merged", json(edge.evidence || []), checkedAt, checkedAt);
  }

  #upsertAcceptedFact(venueId, kind, key, payload, checkedAt) {
    const ttl = this.ttls[kind] ?? this.ttls.resource;
    const validUntil = plus(checkedAt, ttl);
    this.db.prepare(`INSERT INTO facts
      (venue_id, kind, fact_key, decision_status, lifecycle_status, payload_json, evidence_version,
       first_seen, last_seen, last_checked, valid_until, retry_after, last_check_outcome)
      VALUES (?, ?, ?, 'accepted', 'active', ?, ?, ?, ?, ?, ?, ?, 'observed')
      ON CONFLICT(venue_id, kind, fact_key) DO UPDATE SET
        decision_status = 'accepted', lifecycle_status = 'active', payload_json = excluded.payload_json,
        evidence_version = excluded.evidence_version, last_seen = excluded.last_seen,
        last_checked = excluded.last_checked, valid_until = excluded.valid_until,
        retry_after = excluded.retry_after, last_check_outcome = 'observed', retirement_reason = NULL`)
      .run(venueId, kind, key, json(payload), EVIDENCE_VERSION, checkedAt, checkedAt,
        checkedAt, validUntil, validUntil);
    const fact = this.db.prepare("SELECT fact_id FROM facts WHERE venue_id = ? AND kind = ? AND fact_key = ?")
      .get(venueId, kind, key);
    this.#event(fact.fact_id, "observed", checkedAt, "accepted_evidence_observed", []);
  }

  #upsertDecision(venueId, kind, key, status, payload, checkedAt) {
    if (!key || !["review", "rejected"].includes(status)) return;
    const retryAt = plus(checkedAt, this.retryDelays[status]);
    this.db.prepare(`INSERT INTO facts
      (venue_id, kind, fact_key, decision_status, lifecycle_status, payload_json, evidence_version,
       first_seen, last_seen, last_checked, valid_until, retry_after, last_check_outcome)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, kind, fact_key) DO UPDATE SET
        decision_status = excluded.decision_status, payload_json = excluded.payload_json,
        last_seen = excluded.last_seen, last_checked = excluded.last_checked,
        valid_until = excluded.valid_until, retry_after = excluded.retry_after,
        last_check_outcome = excluded.last_check_outcome`)
      .run(venueId, kind, key, status, json(payload), EVIDENCE_VERSION, checkedAt, checkedAt,
        checkedAt, checkedAt, retryAt, status);
  }

  #recordCheckOutcomeById(venueId, observation) {
    const outcome = observation.outcome;
    if (!["not_observed", "temporarily_unreachable", "contradicted"].includes(outcome)) {
      throw new Error(`unsupported evidence check outcome ${String(outcome)}`);
    }
    const checkedAt = iso(observation.checkedAt);
    if (outcome === "contradicted") {
      if (!observation.factKey || !Array.isArray(observation.evidence) || observation.evidence.length === 0) {
        throw new Error("contradictory evidence requires factKey and positive evidence");
      }
      const fact = this.db.prepare(`SELECT fact_id FROM facts
        WHERE venue_id = ? AND kind = ? AND fact_key = ? AND lifecycle_status = 'active'`)
        .get(venueId, observation.kind, observation.factKey);
      if (!fact) return;
      this.db.prepare(`UPDATE facts SET lifecycle_status = 'retired', retirement_reason = ?,
        last_checked = ?, retry_after = ?, last_check_outcome = 'contradicted' WHERE fact_id = ?`)
        .run(observation.reason || "positive_contradictory_evidence", checkedAt, checkedAt, fact.fact_id);
      this.#event(fact.fact_id, "retired", checkedAt,
        observation.reason || "positive_contradictory_evidence", observation.evidence);
      if (observation.kind === "website") {
        const dependants = this.db.prepare(`SELECT fact_id, payload_json FROM facts
          WHERE venue_id = ? AND kind = 'resource' AND lifecycle_status = 'active'`).all(venueId)
          .filter((row) => parseJson(row.payload_json).source_url === observation.factKey);
        for (const dependant of dependants) {
          this.db.prepare(`UPDATE facts SET lifecycle_status = 'retired', retirement_reason = ?,
            last_checked = ?, retry_after = ?, last_check_outcome = 'contradicted' WHERE fact_id = ?`)
            .run("official_website_retired", checkedAt, checkedAt, dependant.fact_id);
          this.#event(dependant.fact_id, "retired", checkedAt, "official_website_retired",
            observation.evidence);
        }
      }
      return;
    }
    const retryAt = iso(observation.retryAfter || plus(checkedAt, this.retryDelays[outcome]));
    const rows = this.db.prepare(`SELECT fact_id FROM facts WHERE venue_id = ?
      AND kind = ? AND decision_status = 'accepted' AND lifecycle_status = 'active'`)
      .all(venueId, observation.kind);
    this.db.prepare(`UPDATE facts SET last_checked = ?, retry_after = ?, last_check_outcome = ?
      WHERE venue_id = ? AND kind = ? AND decision_status = 'accepted' AND lifecycle_status = 'active'`)
      .run(checkedAt, retryAt, outcome, venueId, observation.kind);
    for (const row of rows) this.#event(row.fact_id, "check_failed", checkedAt, outcome,
      observation.evidence || []);
  }

  #retireOtherAcceptedFacts(venueId, kind, acceptedKey, checkedAt, reason) {
    const rows = this.db.prepare(`SELECT fact_id FROM facts WHERE venue_id = ? AND kind = ?
      AND fact_key <> ? AND decision_status = 'accepted' AND lifecycle_status = 'active'`)
      .all(venueId, kind, acceptedKey);
    this.db.prepare(`UPDATE facts SET lifecycle_status = 'retired', retirement_reason = ?,
      last_checked = ?, retry_after = ?, last_check_outcome = 'contradicted'
      WHERE venue_id = ? AND kind = ? AND fact_key <> ?
        AND decision_status = 'accepted' AND lifecycle_status = 'active'`)
      .run(reason, checkedAt, checkedAt, venueId, kind, acceptedKey);
    for (const row of rows) this.#event(row.fact_id, "retired", checkedAt, reason,
      ["new_accepted_fact_for_same_kind"]);
  }

  #recordSearchAttempts(venueId, run, checkedAt) {
    for (const attempt of run?.search_attempts || []) {
      const providerAttempt = attempt.attempts?.at(-1) || attempt;
      this.db.prepare(`INSERT INTO search_attempts
        (venue_id, checked_at, purpose, query, provider, http_status, outcome, latency_ms, cache_status, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(venueId, checkedAt, attempt.kind || attempt.purpose || "official_site",
          attempt.query || "", providerAttempt.provider || null, providerAttempt.http_status ?? null,
          attempt.outcome || providerAttempt.outcome || (attempt.result_count > 0 ? "relevant" : "empty"),
          providerAttempt.duration_ms ?? null, attempt.cache?.status || null, json(attempt));
    }
  }

  #event(factId, type, occurredAt, reason, evidence) {
    this.db.prepare(`INSERT INTO fact_events
      (fact_id, event_type, occurred_at, reason, evidence_json) VALUES (?, ?, ?, ?, ?)`)
      .run(factId, type, occurredAt, reason, json(evidence || []));
  }

  #publisherEvent(attestationId, type, occurredAt, actor, reason, snapshot) {
    this.db.prepare(`INSERT INTO publisher_attestation_events
      (attestation_id, event_type, occurred_at, actor, reason, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(attestationId, type, occurredAt, actor, reason, JSON.stringify(snapshot));
  }

  #transaction(callback) {
    if (this.db.isTransaction) return callback();
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = callback(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function publicFactState(row, at) {
  return {
    fact_id: row.fact_id,
    status: "last_known_good",
    freshness: at < row.valid_until ? "current" : "stale",
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    last_checked: row.last_checked,
    valid_until: row.valid_until,
    retry_after: row.retry_after,
    last_check_outcome: row.last_check_outcome,
    evidence_version: row.evidence_version,
  };
}

function inferCheckOutcome(run) {
  const failedCrawl = (run?.crawl_attempts || []).some((item) => item.outcome !== "accepted");
  const providerFailure = (run?.search_attempts || []).some((item) =>
    ["rate_limited", "provider_failed"].includes(item.outcome)
    || (item.attempts || []).some((attempt) => !attempt.transport_ok || !attempt.parse_ok));
  return failedCrawl || providerFailure ? "temporarily_unreachable" : "not_observed";
}

function requireVenue(venue) {
  if (!venue?.canonical_venue_id || !venue?.name) {
    throw new TypeError("venue requires canonical_venue_id and name");
  }
}
function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("invalid evidence timestamp");
  return date.toISOString();
}
function plus(value, milliseconds) { return new Date(new Date(value).getTime() + milliseconds).toISOString(); }
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function unique(values) { return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))]; }
function json(value) { return JSON.stringify(value ?? null); }
function parseJson(value) { try { return JSON.parse(value); } catch { return {}; } }

const PUBLISHER_METHODS = new Set([
  "manual_first_party_review", "official_registry", "verified_platform_claim",
  "verified_reciprocal_link",
]);
const TRUSTED_ATTESTATION_SOURCES = new Set(["human_review", "official_registry", "verified_control_flow"]);

function validatePublisherAttestationWrite(value, venueId, clock, options) {
  if (!value || !["verified", "rejected"].includes(value.status)) {
    throw new Error("publisher attestation status must be verified or rejected");
  }
  if (!PUBLISHER_METHODS.has(value.method)) throw new Error("unsupported publisher attestation method");
  const websiteUrl = httpUrl(value.website_url);
  const publisherDomain = registrableDomain(websiteUrl);
  if (!websiteUrl || !publisherDomain) throw new Error("publisher attestation requires a valid website domain");
  const evidenceUrls = [...new Set((Array.isArray(value.evidence_urls) ? value.evidence_urls : [])
    .map(httpUrl).filter(Boolean))];
  if (!evidenceUrls.length || evidenceUrls.length !== value.evidence_urls.length) {
    throw new Error("publisher attestation requires valid evidence URLs");
  }
  const reviewer = String(value.reviewer || "").trim();
  if (!reviewer) throw new Error("publisher attestation reviewer is required");
  const reviewedAt = iso(value.reviewed_at);
  const expiresAt = iso(value.expires_at);
  if (expiresAt <= reviewedAt) throw new Error("publisher attestation expiry must follow review time");
  const sourceKind = String(value.source_kind || "").trim();
  if (!TRUSTED_ATTESTATION_SOURCES.has(sourceKind)) {
    throw new Error("publisher attestation source cannot be crawled or search-result content");
  }
  if (value.venue_id && value.venue_id !== venueId) throw new Error("publisher attestation venue mismatch");
  const recordedAt = iso(options.recordedAt || clock());
  if (reviewedAt > recordedAt) throw new Error("publisher attestation review time cannot be in the future");
  return {
    status: value.status,
    method: value.method,
    venue_id: venueId,
    publisher_domain: publisherDomain,
    website_url: websiteUrl,
    evidence_urls: evidenceUrls,
    reviewed_at: reviewedAt,
    expires_at: expiresAt,
    reviewer,
    notes: String(value.notes || "").trim() || undefined,
    source_kind: sourceKind,
    source_fingerprint: String(value.source_fingerprint || "").trim() || undefined,
  };
}

function publicAttestation(row) {
  return {
    status: row.decision_status,
    method: row.method,
    venue_id: row.venue_id,
    publisher_domain: row.publisher_domain,
    website_url: row.attested_website,
    evidence_urls: parseJson(row.evidence_urls_json),
    reviewed_at: row.reviewed_at,
    expires_at: row.expires_at,
    reviewer: row.reviewer,
    notes: row.notes || undefined,
    source_kind: row.source_kind,
    source_fingerprint: row.source_fingerprint || undefined,
    lifecycle_status: row.lifecycle_status,
    attestation_id: row.attestation_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Allowlisted source-record fields for the review queue. The raw payload stays
// in the store; reviewers see only the identity/contact/location evidence they
// need to judge publisher ownership (minimisation, see PRIVACY.md).
function pickSourceEvidence(source, payload) {
  const pick = (key) => {
    const value = payload?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = String(value ?? "").trim();
    return text || undefined;
  };
  return {
    source: String(source || "unknown"),
    name: pick("name"), type: pick("type"), address: pick("address"),
    postcode: pick("postcode"), municipality: pick("municipality"),
    province_code: pick("province_code"), region_code: pick("region_code"),
    phone: pick("phone"), website: pick("website"),
    latitude: pick("latitude"), longitude: pick("longitude"),
  };
}

function reviewCandidateUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function attestationSnapshot(row) {
  const item = publicAttestation(row);
  return JSON.stringify({
    status: item.status, method: item.method, venue_id: item.venue_id,
    publisher_domain: item.publisher_domain, website_url: item.website_url,
    evidence_urls: item.evidence_urls, reviewed_at: item.reviewed_at,
    expires_at: item.expires_at, reviewer: item.reviewer, notes: item.notes,
    source_kind: item.source_kind, source_fingerprint: item.source_fingerprint,
  });
}
function httpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) && url.hostname ? url.href : "";
  } catch { return ""; }
}
function boundedLimit(value, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 500) throw new Error("limit must be from 1 to 500");
  return number;
}
