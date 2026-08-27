import { createScheduledSearchProvider } from "../../lib/provider-scheduler.mjs";
import { createBraveWebApiProvider } from "./brave-web-api.mjs";
import { createLegacyScriptProvider } from "./legacy-script.mjs";

let providers;

export function getDefaultSearchProviders(options = {}) {
  if (options.fresh || !providers) providers = createDefaultSearchProviders(options);
  return providers;
}

export function createDefaultSearchProviders(options = {}) {
  const diagnostic = options.diagnostic ?? process.env.SEARCH_DIAGNOSTIC_LEGACY === "1";
  const provider = diagnostic
    ? createLegacyScriptProvider({ ...options.legacy,
      engine: options.diagnosticEngine || process.env.SEARCH_DIAGNOSTIC_ENGINE || "brave" })
    : createBraveWebApiProvider(options.brave);
  return [createScheduledSearchProvider(provider, {
    requestsPerSecond: 1,
    maxRetries: 1,
    maxAttempts: Number(process.env.SEARCH_PROVIDER_ATTEMPT_BUDGET) || Infinity,
    failureThreshold: 3,
    circuitCooldownMs: 30_000,
    ...options.scheduler,
  })];
}
