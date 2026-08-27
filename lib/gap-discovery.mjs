const DEFAULT_MAX_QUERIES = 4;

export function buildPostcodeGapQueries(location, options = {}) {
  const gaps = options.residualGaps ?? [];
  if (!Array.isArray(gaps) || gaps.length === 0) return [];
  const municipality = clean(location?.municipality);
  const province = clean(location?.province_code);
  const postcode = clean(location?.postcodes?.[0] || location?.postcode);
  if (!municipality || !postcode) return [];
  const requested = new Set(gaps.flatMap((gap) => gap.categories || [gap.category]).filter(Boolean));
  const candidates = [
    { id: "postcode_restaurant_menu", category: "restaurant", query: `"${postcode}" ristorante menu` },
    { id: "postcode_pizzeria_menu", category: "pizzeria", query: `"${postcode}" pizzeria menu` },
    { id: "municipality_province_restaurant_menu", category: "restaurant",
      query: `"${municipality}" "${province}" ristorante menu` },
    { id: "postcode_bar_menu", category: "bar", query: `"${postcode}" bar menu` },
  ];
  const eligible = requested.size
    ? candidates.filter((item) => requested.has(item.category) || requested.has("food"))
    : candidates;
  const maxQueries = Math.min(DEFAULT_MAX_QUERIES, Math.max(0, options.maxQueries ?? DEFAULT_MAX_QUERIES));
  return eligible.slice(0, maxQueries);
}

export function evaluateGapQueryReplay(templates, alreadyFoundTruthIds = []) {
  const found = new Set(alreadyFoundTruthIds);
  const rows = [];
  for (const template of templates) {
    const aligned = (template.results || []).filter((item) => item.aligned === true);
    const truthIds = [...new Set(aligned.map((item) => item.truth_id).filter(Boolean))];
    const marginal = truthIds.filter((id) => !found.has(id));
    marginal.forEach((id) => found.add(id));
    rows.push({
      id: template.id,
      query: template.query,
      result_count: (template.results || []).length,
      aligned_result_count: aligned.length,
      aligned_ratio: ratio(aligned.length, (template.results || []).length),
      marginal_truth_ids: marginal,
      keep: marginal.length > 0,
    });
  }
  return { max_queries: DEFAULT_MAX_QUERIES, queries_run: rows.length, templates: rows,
    retained_template_ids: rows.filter((item) => item.keep).map((item) => item.id) };
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 10_000 : 0;
}
function clean(value) { return String(value || "").trim(); }
