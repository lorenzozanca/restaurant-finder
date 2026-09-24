// Budget-capped OpenRouter chat client for the LLM ownership reviewer.
// Every call reserves its worst-case cost before it is sent and books the
// reported `usage.cost` afterwards; a call that could cross the cap is refused.

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class BudgetExhaustedError extends Error {
  constructor(message) { super(message); this.name = "BudgetExhaustedError"; }
}

export function readOpenRouterKey(env = process.env) {
  // The operator stores the key as OPENROUTER in .env.
  return String(env.OPENROUTER_API_KEY || env.OPENROUTER || "").trim();
}

export function createOpenRouterClient(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw new Error("OpenRouter API key is required");
  const budgetUsd = Number(options.budgetUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("a positive USD budget is required");
  const fetchImpl = options.fetch || fetch;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const timeout = options.timeout || 120_000;
  const maxAttempts = options.maxAttempts || 3;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const prices = new Map(Object.entries(options.prices || {}));
  let spent = Math.max(0, Number(options.spentUsd) || 0);
  let reserved = 0;

  async function loadPrices(models) {
    const missing = models.filter((model) => !prices.has(model));
    if (!missing.length) return;
    const response = await fetchImpl(`${baseUrl}/models`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`OpenRouter model catalog HTTP ${response.status}`);
    const catalog = (await response.json()).data || [];
    for (const model of missing) {
      const entry = catalog.find((item) => item.id === model);
      if (!entry) throw new Error(`model not in OpenRouter catalog: ${model}`);
      prices.set(model, priceFromCatalog(entry.pricing));
    }
  }

  async function complete(request) {
    const model = required(request.model, "model");
    const price = prices.get(model);
    if (!price) throw new Error(`no price loaded for ${model}`);
    const maxTokens = request.maxTokens || 2_000;
    const inputChars = request.messages.reduce((sum, message) => sum + String(message.content).length, 0)
      + JSON.stringify(request.schema || {}).length;
    // Three characters per token over-estimates Italian and English prompt tokens.
    const worstCase = price.request + price.prompt * Math.ceil(inputChars / 3)
      + price.completion * maxTokens;
    if (spent + reserved + worstCase > budgetUsd) {
      throw new BudgetExhaustedError(`budget $${budgetUsd} reached: spent $${spent.toFixed(4)}, `
        + `reserved $${reserved.toFixed(4)}, next call up to $${worstCase.toFixed(4)}`);
    }
    reserved += worstCase;
    let booked = 0;
    try {
      const body = {
        model,
        messages: request.messages,
        // Reasoning models such as OpenAI's reject temperature; pass null to omit it.
        ...(request.temperature === null ? {} : { temperature: request.temperature ?? 0 }),
        max_tokens: maxTokens,
        provider: {
          data_collection: "deny",
          require_parameters: true,
          ...(request.zdr ? { zdr: true } : {}),
        },
        ...(request.schema ? { response_format: { type: "json_schema", json_schema: {
          name: request.schemaName || "response", strict: true, schema: request.schema } } } : {}),
        ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      };
      let lastError;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response;
        try {
          response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json",
              "x-title": "restaurant-finder ownership reviewer" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeout),
          });
        } catch (error) {
          lastError = new Error(`OpenRouter transport failure: ${error?.cause?.code || error?.name}`);
          if (attempt < maxAttempts) { await sleep(1_000 * attempt); continue; }
          throw lastError;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.error) {
          const status = payload.error?.code || response.status;
          lastError = new Error(`OpenRouter HTTP ${status}: ${String(payload.error?.message || "").slice(0, 200)}`);
          lastError.status = Number(status) || response.status;
          if ([408, 429, 500, 502, 503, 504].includes(lastError.status) && attempt < maxAttempts) {
            await sleep(2_000 * attempt);
            continue;
          }
          throw lastError;
        }
        const usage = payload.usage || {};
        // Without a reported cost, book the reservation: never under-count spend.
        booked = Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : worstCase;
        const content = String(payload.choices?.[0]?.message?.content || "");
        return {
          model: payload.model || model,
          provider: payload.provider || "",
          generation_id: payload.id || "",
          content,
          json: parseJsonContent(content),
          finish_reason: payload.choices?.[0]?.finish_reason || "",
          usage: {
            prompt_tokens: Number(usage.prompt_tokens) || 0,
            completion_tokens: Number(usage.completion_tokens) || 0,
            reasoning_tokens: Number(usage.completion_tokens_details?.reasoning_tokens) || 0,
          },
          cost_usd: booked,
        };
      }
      throw lastError;
    } finally {
      reserved -= worstCase;
      spent += booked;
    }
  }

  return {
    loadPrices,
    complete,
    spentUsd: () => spent,
    remainingUsd: () => Math.max(0, budgetUsd - spent - reserved),
    budgetUsd,
  };
}

export function priceFromCatalog(pricing = {}) {
  const value = (key) => Math.max(0, Number(pricing[key]) || 0);
  return {
    prompt: value("prompt"),
    // Reasoning tokens are billed as completion tokens unless priced separately.
    completion: Math.max(value("completion"), value("internal_reasoning")),
    request: value("request"),
  };
}

function parseJsonContent(content) {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); } catch { return null; }
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}
