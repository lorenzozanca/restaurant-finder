import { validateLocationContext } from "./lib/location-context.mjs";

export const CURRENT_SCHEMA_VERSION = 2;

// Search snippets are useful while scoring provider results, but they are
// third-party prose and are not part of the publishable scan contract.
export function serializeScanDocument(scan) {
  return JSON.stringify(scan, (key, value) => key === "snippet" ? undefined : value, 2);
}

// Saved scans predating schema versioning are still useful. Normalize their
// renamed fields at the API boundary without rewriting the original file.
export function normalizeScanDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw schemaError("scan must be a JSON object");
  }
  const version = value.schema_version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw schemaError(`invalid schema version ${String(version)}`);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw schemaError(
      `scan schema ${version} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`
    );
  }

  const restaurants = Array.isArray(value.restaurants)
    ? value.restaurants.map(normalizeRestaurant)
    : [];
  return {
    ...value,
    schema_version: version,
    with_resources: value.with_resources ?? value.with_menu ?? restaurants
      .filter((restaurant) => restaurant.resources.length > 0).length,
    restaurants,
  };
}

export function validateCurrentScanDocument(scan) {
  if (scan?.schema_version !== CURRENT_SCHEMA_VERSION) {
    throw schemaError(`expected schema version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(scan.source_runs)) throw schemaError("source_runs must be an array");
  if (scan.location_context) {
    try { validateLocationContext(scan.location_context); }
    catch (error) { throw schemaError(`invalid location_context: ${error.message}`); }
    if (scan.location && normalizePlace(scan.location) !== normalizePlace(scan.location_context.municipality)) {
      throw schemaError("location_context municipality does not match location");
    }
  }
  for (const run of scan.source_runs) {
    if (!run?.source || !["succeeded", "degraded", "failed", "disabled"].includes(run.status)) {
      throw schemaError("source run has an invalid source or status");
    }
    if (!Number.isInteger(run.result_count) || run.result_count < 0) {
      throw schemaError(`${run.source}: source run result_count must be a non-negative integer`);
    }
    if (run.useful_result_count !== undefined
        && (!Number.isInteger(run.useful_result_count) || run.useful_result_count < 0
          || run.useful_result_count > run.result_count)) {
      throw schemaError(`${run.source}: source run useful_result_count must be between zero and result_count`);
    }
    if (run.query_yield !== undefined) {
      if (!Array.isArray(run.query_yield) || run.query_yield.length > 4) {
        throw schemaError(`${run.source}: query yield must contain at most four entries`);
      }
      for (const row of run.query_yield) {
        if (!row?.template_id || !row.query || !row.outcome
            || !Number.isInteger(row.result_count) || row.result_count < 0
            || !Number.isInteger(row.accepted_candidate_count) || row.accepted_candidate_count < 0
            || !Number.isInteger(row.marginal_candidate_count) || row.marginal_candidate_count < 0
            || row.marginal_candidate_count > row.accepted_candidate_count) {
          throw schemaError(`${run.source}: query yield row is invalid`);
        }
      }
    }
  }
  if (!Array.isArray(scan.restaurants)) throw schemaError("restaurants must be an array");
  if (scan.evidence_store !== undefined) validateEvidenceStoreSummary(scan.evidence_store);
  if (scan.enrichment_run) validateEnrichmentRun(scan.enrichment_run, "scan");
  for (const restaurant of scan.restaurants) validateRestaurantProvenance(restaurant);
  return scan;
}

function validateRestaurantProvenance(restaurant) {
  const label = restaurant?.name || "unnamed restaurant";
  for (const field of [
    "name", "type", "address", "phone", "website", "cuisine",
    "latitude", "longitude", "osm_id", "overture_id", "provider_place_id",
    "provider_record_url", "postcode", "address_components", "directory_url",
    "canonical_venue_id",
  ]) {
    const value = restaurant?.[field];
    if (value === undefined || value === null || value === "") continue;
    if (!Array.isArray(restaurant.provenance?.[field]) || restaurant.provenance[field].length === 0) {
      throw schemaError(`${label}: ${field} is missing provenance`);
    }
  }
  if (restaurant.canonical_venue_id) {
    if (!Array.isArray(restaurant.aliases) || restaurant.aliases.length === 0) {
      throw schemaError(`${label}: canonical venue is missing aliases`);
    }
    if (!Array.isArray(restaurant.source_records) || restaurant.source_records.length === 0) {
      throw schemaError(`${label}: canonical venue is missing source records`);
    }
    if (!Array.isArray(restaurant.merge_audit)) {
      throw schemaError(`${label}: canonical venue is missing merge audit data`);
    }
    const sourceRecordIds = new Set();
    for (const sourceRecord of restaurant.source_records) {
      if (!sourceRecord?.source_record_id || !sourceRecord.source || !sourceRecord.name) {
        throw schemaError(`${label}: source record is missing identity fields`);
      }
      if (sourceRecordIds.has(sourceRecord.source_record_id)) {
        throw schemaError(`${label}: source record IDs must be unique`);
      }
      sourceRecordIds.add(sourceRecord.source_record_id);
    }
    for (const decision of restaurant.merge_audit) {
      if (decision?.status !== "merged"
          || !sourceRecordIds.has(decision.left_source_record_id)
          || !sourceRecordIds.has(decision.right_source_record_id)
          || !Array.isArray(decision.evidence) || decision.evidence.length < 2) {
        throw schemaError(`${label}: merge audit is incomplete or references an unknown source record`);
      }
    }
    if (restaurant.identity_review !== undefined && !Array.isArray(restaurant.identity_review)) {
      throw schemaError(`${label}: identity review must be an array`);
    }
    for (const decision of restaurant.identity_review || []) {
      const belongsToVenue = sourceRecordIds.has(decision?.left_source_record_id)
        || sourceRecordIds.has(decision?.right_source_record_id);
      if (decision?.status !== "review" || !belongsToVenue || !decision.reason
          || !Array.isArray(decision.evidence) || decision.evidence.length === 0) {
        throw schemaError(`${label}: identity review is incomplete`);
      }
    }
  }
  for (const resource of restaurant?.resources || []) {
    if (!resource?.url || !resource.found_via || !resource.source_url
        || !Array.isArray(resource.evidence) || resource.evidence.length === 0
        || !resource.checked_at) {
      throw schemaError(`${label}: resource is missing provenance or validation evidence`);
    }
  }
  for (const decision of restaurant?.resource_decisions || []) {
    if (!["accepted", "review", "rejected"].includes(decision?.status)
        || !decision.requested_url || !decision.final_url || !decision.role
        || !Number.isInteger(decision.http_status) || decision.http_status < 0
        || !decision.checked_at || !Array.isArray(decision.evidence) || decision.evidence.length === 0) {
      throw schemaError(`${label}: resource decision is missing validation evidence`);
    }
    if (decision.freshness !== undefined
        && !["current", "undated", "review", "stale"].includes(decision.freshness)) {
      throw schemaError(`${label}: resource decision has invalid freshness`);
    }
  }
  if (restaurant?.website_decision) validateWebsiteDecision(restaurant.website_decision, label);
  if (restaurant?.evidence_state) validateEvidenceState(restaurant.evidence_state, label);
  if (restaurant?.enrichment_run) validateEnrichmentRun(restaurant.enrichment_run, label);
}

function validateEvidenceStoreSummary(summary) {
  for (const field of ["schema_version", "evidence_version"]) {
    if (!Number.isInteger(summary?.[field]) || summary[field] < 1) {
      throw schemaError(`evidence store ${field} must be a positive integer`);
    }
  }
  for (const field of ["reused_venues", "stale_venues", "due_for_revalidation"]) {
    if (!Number.isInteger(summary?.[field]) || summary[field] < 0) {
      throw schemaError(`evidence store ${field} must be a non-negative integer`);
    }
  }
  if (summary.stale_venues > summary.reused_venues
      || summary.due_for_revalidation > summary.reused_venues) {
    throw schemaError("evidence store reuse counters are inconsistent");
  }
}

function validateEvidenceState(state, label) {
  if (state.source !== "sqlite_last_known_good" || !state.venue_id
      || typeof state.due_for_revalidation !== "boolean"
      || !Array.isArray(state.resources)) {
    throw schemaError(`${label}: durable evidence state is incomplete`);
  }
  for (const fact of [state.website, ...state.resources].filter(Boolean)) {
    if (fact.status !== "last_known_good" || !["current", "stale"].includes(fact.freshness)
        || !fact.first_seen || !fact.last_seen || !fact.last_checked || !fact.valid_until
        || !fact.retry_after || !fact.last_check_outcome
        || !Number.isInteger(fact.evidence_version) || fact.evidence_version < 1) {
      throw schemaError(`${label}: durable fact audit state is incomplete`);
    }
  }
}

function validateWebsiteDecision(decision, label) {
  if (!["accepted", "review", "rejected"].includes(decision.status)) {
    throw schemaError(`${label}: website decision has an invalid status`);
  }
  for (const field of ["identity", "geography", "officialness"]) {
    if (!Number.isInteger(decision.scores?.[field])
        || decision.scores[field] < 0 || decision.scores[field] > 100) {
      throw schemaError(`${label}: website decision ${field} score must be an integer from 0 to 100`);
    }
  }
  if (!Array.isArray(decision.evidence)) {
    throw schemaError(`${label}: website decision evidence must be an array`);
  }
}

function validateEnrichmentRun(run, label) {
  if (run.strategy !== "website_first") throw schemaError(`${label}: invalid enrichment strategy`);
  for (const field of ["crawl_requests", "crawl_cache_hits", "search_requests"]) {
    if (!Number.isInteger(run[field]) || run[field] < 0) {
      throw schemaError(`${label}: ${field} must be a non-negative integer`);
    }
  }
  for (const field of ["resource_discovery_requests", "resource_site_search_requests", "resource_validation_requests"]) {
    if (run[field] !== undefined && (!Number.isInteger(run[field]) || run[field] < 0)) {
      throw schemaError(`${label}: ${field} must be a non-negative integer`);
    }
  }
  if (run.resource_stage_metrics !== undefined) {
    validateResourceStageMetrics(run.resource_stage_metrics, label);
  }
  if (run.search_attempts && !Array.isArray(run.search_attempts)) {
    throw schemaError(`${label}: search_attempts must be an array`);
  }
  if (Array.isArray(run.search_attempts)) {
    if (run.search_attempts.length !== run.search_requests) {
      throw schemaError(`${label}: search request count does not match search attempts`);
    }
    for (const attempt of run.search_attempts) {
      if (!attempt?.kind || !attempt.reason || !attempt.query
          || !Number.isInteger(attempt.result_count) || attempt.result_count < 0) {
        throw schemaError(`${label}: search attempt is missing its reason or request facts`);
      }
    }
  }
  if (run.resolver_status !== undefined) {
    if (!['accepted', 'budget_exhausted'].includes(run.resolver_status)
        || !run.resolver_stop_reason) {
      throw schemaError(`${label}: resolver must stop accepted or budget_exhausted with a reason`);
    }
    const budget = run.resolver_budget;
    if (!budget || !Number.isInteger(budget.searches) || budget.searches < 0 || budget.searches > 3
        || !Number.isInteger(budget.crawls) || budget.crawls < 0 || budget.crawls > 3) {
      throw schemaError(`${label}: resolver budget is invalid`);
    }
    if (budget.searches === 3 && !budget.budget_escalation_reason) {
      throw schemaError(`${label}: third resolver search is missing an escalation reason`);
    }
    if (run.search_requests > budget.searches) {
      throw schemaError(`${label}: resolver exceeded its search budget`);
    }
    if (!Array.isArray(run.crawl_attempts) || run.crawl_attempts.length > budget.crawls) {
      throw schemaError(`${label}: resolver exceeded its crawl budget`);
    }
    for (const attempt of run.crawl_attempts) {
      if (!attempt?.requested_url || !attempt.final_url
          || !['accepted', 'review', 'rejected'].includes(attempt.outcome)
          || !['source_provided', 'web_search'].includes(attempt.origin)
          || !Number.isInteger(attempt.request_count) || attempt.request_count < 0
          || (attempt.search_rank !== null
            && (!Number.isInteger(attempt.search_rank) || attempt.search_rank < 1))) {
        throw schemaError(`${label}: resolver crawl attempt is invalid`);
      }
    }
    if (!Array.isArray(run.resolver_candidate_decisions)
        || run.resolver_candidate_decisions.length !== run.crawl_attempts.length) {
      throw schemaError(`${label}: resolver candidate decisions do not match crawl attempts`);
    }
    for (const decision of run.resolver_candidate_decisions) {
      if (!decision?.url || !['accepted', 'review', 'rejected'].includes(decision.outcome)
          || !Array.isArray(decision.reasons)) {
        throw schemaError(`${label}: resolver candidate decision is invalid`);
      }
    }
  }
}

function validateResourceStageMetrics(metrics, label) {
  const fields = ["candidates", "accepted", "review", "rejected", "pre_cap_dropped", "post_cap_dropped"];
  const buckets = [metrics?.totals, ...Object.values(metrics?.by_role || {})];
  if (!metrics?.totals || !metrics?.by_role || buckets.some((bucket) =>
    fields.some((field) => !Number.isInteger(bucket?.[field]) || bucket[field] < 0))) {
    throw schemaError(`${label}: resource stage metrics are incomplete`);
  }
  for (const field of fields) {
    const total = Object.values(metrics.by_role).reduce((sum, bucket) => sum + bucket[field], 0);
    if (total !== metrics.totals[field]) throw schemaError(`${label}: resource stage metric totals do not match roles`);
  }
}

function normalizeRestaurant(value) {
  const restaurant = value && typeof value === "object" ? value : {};
  return {
    ...restaurant,
    resources: Array.isArray(restaurant.resources)
      ? restaurant.resources
      : Array.isArray(restaurant.menu_sources) ? restaurant.menu_sources : [],
  };
}

function schemaError(message) {
  const error = new Error(message);
  error.code = "UNSUPPORTED_SCAN_SCHEMA";
  return error;
}

function normalizePlace(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
