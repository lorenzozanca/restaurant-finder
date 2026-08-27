export async function runSource(source, fn, ...args) {
  const startedAt = new Date();
  const started = Date.now();
  try {
    const result = await fn(...args);
    const items = Array.isArray(result) ? result : result?.items;
    if (!Array.isArray(items)) throw new Error("source returned a non-array result");
    const health = Array.isArray(result) ? {} : (result.source_health || {});
    const status = health.status || "succeeded";
    if (!["succeeded", "degraded"].includes(status)) {
      throw new Error(`source returned invalid health status: ${status}`);
    }
    return {
      items,
      manifest: {
        source,
        status,
        attempted_at: startedAt.toISOString(),
        duration_ms: Date.now() - started,
        result_count: items.length,
        useful_result_count: health.useful_result_count ?? items.length,
        ...(health.reason ? { reason: health.reason } : {}),
        ...(Array.isArray(health.search_outcomes) ? { search_outcomes: health.search_outcomes } : {}),
        ...(Array.isArray(health.search_attempts) ? { search_attempts: health.search_attempts } : {}),
        ...(Array.isArray(health.query_yield) ? { query_yield: health.query_yield } : {}),
        ...(health.import_report ? { import_report: health.import_report } : {}),
      },
    };
  } catch (error) {
    return {
      items: [],
      manifest: {
        source,
        status: "failed",
        attempted_at: startedAt.toISOString(),
        duration_ms: Date.now() - started,
        result_count: 0,
        useful_result_count: 0,
        error: String(error?.message || error).slice(0, 300),
      },
    };
  }
}

export function disabledSourceRun(source) {
  return {
    items: [],
    manifest: { source, status: "disabled", result_count: 0 },
  };
}

export function sourceResult(items, sourceHealth = {}) {
  return { items, source_health: sourceHealth };
}
