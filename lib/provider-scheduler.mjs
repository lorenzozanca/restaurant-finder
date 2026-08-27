const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createScheduledSearchProvider(provider, options = {}) {
  if (!provider?.search || typeof provider.search !== "function") {
    throw new TypeError("scheduled provider must expose search(request)");
  }

  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random || Math.random;
  const minIntervalMs = options.minIntervalMs ?? intervalFromRps(options.requestsPerSecond ?? 1);
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 1);
  const maxRetries = Math.max(0, options.maxRetries ?? 1);
  const maxAttempts = finiteOrInfinity(options.maxAttempts);
  const failureThreshold = Math.max(1, options.failureThreshold ?? 3);
  const circuitCooldownMs = Math.max(0, options.circuitCooldownMs ?? 30_000);
  const baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 1_000);
  const maxBackoffMs = Math.max(baseBackoffMs, options.maxBackoffMs ?? 30_000);
  const jitterRatio = Math.max(0, options.jitterRatio ?? 0.2);

  let nextStartAt = 0;
  let attemptsUsed = 0;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;
  let launchTail = Promise.resolve();
  let active = 0;
  const concurrencyWaiters = [];

  async function acquireConcurrency() {
    if (active < maxConcurrency) {
      active++;
      return;
    }
    await new Promise((resolve) => concurrencyWaiters.push(resolve));
    active++;
  }

  function releaseConcurrency() {
    active--;
    concurrencyWaiters.shift()?.();
  }

  async function reserveLaunch() {
    let release;
    const predecessor = launchTail;
    launchTail = new Promise((resolve) => { release = resolve; });
    await predecessor;
    try {
      const delay = Math.max(0, nextStartAt - now());
      if (delay) await sleep(delay);
      nextStartAt = Math.max(nextStartAt, now()) + minIntervalMs;
    } finally {
      release();
    }
  }

  async function search(request) {
    if (now() < circuitOpenUntil) {
      return syntheticFailure(provider, "circuit_open", { circuit_open_until: circuitOpenUntil });
    }
    if (attemptsUsed >= maxAttempts) return syntheticFailure(provider, "budget_exhausted");

    const providerAttempts = [];
    let final;
    for (let retry = 0; retry <= maxRetries; retry++) {
      if (attemptsUsed >= maxAttempts) {
        final = syntheticFailure(provider, "budget_exhausted");
        providerAttempts.push(final);
        break;
      }
      if (retry > 0) {
        const waitMs = retryDelayMs(final, retry, {
          now, random, baseBackoffMs, maxBackoffMs, jitterRatio,
        });
        if (waitMs) await sleep(waitMs);
      }

      await acquireConcurrency();
      if (attemptsUsed >= maxAttempts) {
        releaseConcurrency();
        final = syntheticFailure(provider, "budget_exhausted");
        providerAttempts.push(final);
        break;
      }
      try {
        await reserveLaunch();
        attemptsUsed++;
        const started = now();
        try {
          final = await provider.search(request);
        } catch (error) {
          final = failureFromError(provider, error);
        }
        final = normalizeAttempt(provider, final, Math.max(0, now() - started));
      } finally {
        releaseConcurrency();
      }
      providerAttempts.push(final);
      if (!isRetryable(final) || retry === maxRetries) break;
    }

    if (isProviderFailure(final)) {
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold) {
        circuitOpenUntil = now() + circuitCooldownMs;
      }
    } else {
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
    }

    return { ...final, provider_attempts: providerAttempts };
  }

  return {
    name: provider.name || "unknown",
    version: provider.version || "1",
    endpointVersion: provider.endpointVersion || provider.version || "1",
    search,
    health() {
      return { attempts_used: attemptsUsed, consecutive_failures: consecutiveFailures,
        circuit_open_until: circuitOpenUntil };
    },
  };
}

function normalizeAttempt(provider, value, measuredDuration) {
  const attempt = value && typeof value === "object" ? value : {};
  return {
    ...attempt,
    provider: attempt.provider || provider.name || "unknown",
    http_status: attempt.http_status ?? null,
    transport_ok: attempt.transport_ok === true,
    parse_ok: attempt.parse_ok === true,
    duration_ms: attempt.duration_ms ?? measuredDuration,
    rate_headers: attempt.rate_headers || {},
    results: Array.isArray(attempt.results) ? attempt.results : [],
  };
}

function failureFromError(provider, error) {
  const timeout = error?.name === "AbortError" || error?.code === "ETIMEDOUT" || error?.killed;
  return syntheticFailure(provider, timeout ? "timeout" : "transport_error");
}

function syntheticFailure(provider, reason, extra = {}) {
  return {
    provider: provider.name || "unknown", http_status: null, transport_ok: false,
    parse_ok: false, raw_count: 0, duration_ms: 0, rate_headers: {}, results: [], reason, ...extra,
  };
}

function isRetryable(attempt) {
  return !attempt.transport_ok || RETRYABLE_STATUS.has(attempt.http_status);
}

function isProviderFailure(attempt) {
  return !attempt?.transport_ok || !attempt?.parse_ok || RETRYABLE_STATUS.has(attempt?.http_status);
}

function retryDelayMs(attempt, retry, options) {
  const reset = resetDelayMs(attempt?.rate_headers, options.now());
  if (reset !== null) return reset;
  const exponential = Math.min(options.maxBackoffMs, options.baseBackoffMs * (2 ** (retry - 1)));
  const jitter = exponential * options.jitterRatio * options.random();
  return Math.round(exponential + jitter);
}

function resetDelayMs(headers = {}, nowMs) {
  const raw = header(headers, "x-ratelimit-reset") ?? header(headers, "retry-after");
  if (raw === undefined || raw === null || raw === "") return null;
  const values = String(raw).split(",").map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (values.length) {
    const value = Math.max(...values);
    if (value > 1_000_000_000) return Math.max(0, value * 1_000 - nowMs);
    return value * 1_000;
  }
  const httpDate = Date.parse(String(raw));
  return Number.isFinite(httpDate) ? Math.max(0, httpDate - nowMs) : null;
}

function header(headers, key) {
  const found = Object.keys(headers).find((name) => name.toLowerCase() === key);
  return found ? headers[found] : undefined;
}

function intervalFromRps(value) {
  const rps = Number(value);
  return Number.isFinite(rps) && rps > 0 ? Math.ceil(1_000 / rps) : 1_000;
}

function finiteOrInfinity(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : Infinity;
}
