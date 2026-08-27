export function createReplaySearchProvider(fixtures, options = {}) {
  const byQuery = new Map((fixtures || []).map((fixture) => [fixture.request.query, fixture]));
  return {
    name: options.name || "fixture_replay",
    async search(request) {
      const fixture = byQuery.get(request.query);
      if (!fixture) throw new Error(`no replay fixture for query: ${request.query}`);
      return structuredClone(fixture.attempt);
    },
  };
}
