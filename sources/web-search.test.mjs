import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDiscoveryPage,
  discover,
  evaluateWebCandidate,
  extractPageMetadata,
  extractRestaurantName,
} from "./web-search.mjs";
import { runSource } from "../source-run.mjs";

test("recognizes a one-word brand in a generic homepage title", () => {
  assert.equal(
    extractRestaurantName("Home - barhacca", "", "https://www.barhacca.it/"),
    "Barhacca"
  );
});

test("does not turn an unrelated generic one-word title into a venue", () => {
  assert.equal(
    extractRestaurantName("Home - Welcome", "", "https://example.com/"),
    null
  );
});

test("keeps Gli Ingordi from its existing search title", () => {
  assert.equal(
    extractRestaurantName("Gli Ingordi - Tutto l'asporto che vuoi - Oderzo (TV)"),
    "Gli Ingordi"
  );
});

test("takes the venue brand after a generic SEO title segment", () => {
  assert.equal(
    extractRestaurantName("Ristorante Pizzeria in centro Oderzo - Al Giardinetto Ristorante Pizzeria tipico"),
    "Al Giardinetto"
  );
});

test("extracts a pub name when the venue type leads the title", () => {
  assert.equal(
    extractRestaurantName("Pub Gatto Nero - Oderzo"),
    "Gatto Nero"
  );
});

test("extracts a street address and phone from visible page text", () => {
  const html = `
    <footer>Piazzale Europa 4, Oderzo (TV) · TEL 0422 716104</footer>
  `;
  assert.deepEqual(extractPageMetadata(html, "Oderzo"), {
    address: "Piazzale Europa 4",
    address_components: { street: "Piazzale Europa 4" },
    address_source: "page_text",
    location_mentions: [{ type: "municipality", value: "Oderzo", source: "page_text" }],
    phone: "0422 716104",
  });
});

test("never appends the requested town to an unrelated extracted street", () => {
  const milan = extractPageMetadata("<footer>Via Valtellina 55, Milano</footer>", "Oderzo");
  const rome = extractPageMetadata("<footer>Via Appia Nuova 12, Roma</footer>", "Oderzo");
  assert.equal(milan.address, "Via Valtellina 55");
  assert.equal(rome.address, "Via Appia Nuova 12");
  assert.equal(milan.address.includes("Oderzo"), false);
  assert.equal(rome.address.includes("Oderzo"), false);
});

test("extracts structured metadata when JSON-LD is available", () => {
  const html = `<script type="application/ld+json">{
    "@type":"Restaurant",
    "name":"Gli Ingordi",
    "telephone":"0422.713474",
    "address":{"streetAddress":"Via Garibaldi, 39/A","postalCode":"31046","addressLocality":"Oderzo"}
  }</script>`;
  assert.deepEqual(extractPageMetadata(html, "Oderzo"), {
    name: "Gli Ingordi",
    venue_schema: true,
    phone: "0422.713474",
    address: "Via Garibaldi, 39/A, 31046, Oderzo",
    address_components: {
      street: "Via Garibaldi, 39/A",
      postal_code: "31046",
      locality: "Oderzo",
    },
    address_source: "structured_data",
  });
});

test("prefers a restaurant identity over generic website structured data", () => {
  const html = `
    <script type="application/ld+json">{"@type":"WebSite","name":"Pizzeria in centro Oderzo"}</script>
    <script type="application/ld+json">{"@type":"Restaurant","name":"Al Giardinetto"}</script>`;
  assert.equal(extractPageMetadata(html, "Oderzo").name, "Al Giardinetto");
});

const target = { town: "Oderzo", province: "TV", postcodes: ["31046"] };

test("admits Barhacca and Pub Gatto Nero with positive local identity", () => {
  for (const candidate of [
    {
      name: "Barhacca", title: "Home - barhacca",
      snippet: "Bar e ristorante a Oderzo (TV)", url: "https://www.barhacca.it/",
    },
    {
      name: "Pub Gatto Nero", title: "Pub Gatto Nero - Oderzo",
      snippet: "Birreria in provincia di Treviso", url: "https://gattoneropub.it/",
    },
  ]) {
    const decision = evaluateWebCandidate(candidate, target);
    assert.equal(decision.status, "accepted", candidate.name);
    assert.deepEqual(decision.reasons, ["positive_identity_and_location"]);
  }
});

test("rejects the eight known Oderzo false-positive classes", () => {
  const candidates = [
    { name: "BdueB", title: "Trattoria La Fornasetta Milano", snippet: "Cucina milanese", url: "https://trattoriamilano.com/" },
    { name: "Cercare Vicino A Me", title: "Trattorie e osterie vicino a me", snippet: "Trova un locale", url: "https://cercarevicinoame.it/trattorie-e-osterie-vicino-a-me/" },
    { name: "Contributori Ai Progetti Wikimedia", title: "Contributori ai progetti Wikimedia", snippet: "Wikipedia", url: "https://example.test/wiki" },
    { name: "Milano Pocket", title: "Le migliori trattorie a Milano", snippet: "La nostra classifica", url: "https://milanopocket.it/migliori-trattorie-milano/" },
    { name: "Roma Pop", title: "Le migliori trattorie a Roma", snippet: "Dove mangiare", url: "https://romapop.it/trattorie-roma/" },
    { name: "San Filippo Neri", title: "Trattoria San Filippo Neri", snippet: "Cucina milanese", url: "https://trattoriasanfilipponeri.it/" },
    { name: "Scatti Di Gusto", title: "35 migliori trattorie a Milano", snippet: "Guida alle trattorie", url: "https://scattidigusto.it/migliori-trattorie-milano/" },
    { name: "Trattoria Contemporanea", title: "Trattoria Contemporanea a Lomazzo, Como", snippet: "Ristorante contemporaneo", url: "https://trattoriacontemporanea.it/" },
  ];
  for (const candidate of candidates) {
    const decision = evaluateWebCandidate(candidate, target);
    assert.equal(decision.status, "rejected", candidate.name);
    assert.ok(decision.reasons.length > 0, candidate.name);
  }
});

test("structured locality and province contradictions override venue terms", () => {
  const decision = evaluateWebCandidate({
    name: "Wrong Branch",
    title: "Ristorante Wrong Branch",
    url: "https://wrong.example/",
    metadata: {
      venue_schema: true,
      address_components: { locality: "Lomazzo", province: "CO" },
    },
  }, target);
  assert.equal(decision.status, "rejected");
  assert.deepEqual(decision.reasons.sort(), ["municipality_contradiction", "province_contradiction"]);
});

test("rejects generic branch and page-section names", () => {
  for (const name of ["Oderzo", "Selezione", "Ristoranti Old Wild West"]) {
    const decision = evaluateWebCandidate({ name, title: `${name} ristorante Oderzo`,
      snippet: "Ristorante a Oderzo", url: "https://example.test/" }, target);
    assert.equal(decision.status, "rejected", name);
    assert.deepEqual(decision.reasons, ["generic_or_location_name"]);
  }
});

test("rejects a page with a contradictory structured postcode", () => {
  const decision = evaluateWebCandidate({ name: "Wrong Place", title: "Ristorante Wrong Place Oderzo",
    metadata: { venue_schema: true, address: "Via Roma 1, 83013",
      address_components: { postal_code: "83013" } }, url: "https://wrong.example/" }, target);
  assert.equal(decision.status, "rejected");
  assert.ok(decision.reasons.includes("postcode_contradiction"));
});

test("does not treat a local Via Roma address as a province contradiction", () => {
  const decision = evaluateWebCandidate({
    name: "Osteria Centrale",
    title: "Osteria Centrale - Oderzo (TV)",
    snippet: "Ci trovi in Via Roma 12",
    url: "https://osteriacentrale.example/",
  }, target);
  assert.equal(decision.status, "accepted");
});

test("classifies directory, editorial, and boilerplate pages with reason codes", () => {
  assert.deepEqual(
    classifyDiscoveryPage("Ristoranti", "", "https://www.tripadvisor.it/example"),
    ["directory_or_aggregator"]
  );
  assert.deepEqual(
    classifyDiscoveryPage("I migliori ristoranti", "", "https://example.test/list"),
    ["editorial_or_list_page"]
  );
  assert.deepEqual(
    classifyDiscoveryPage("Contributori ai progetti Wikimedia", "", "https://example.test/wiki"),
    ["boilerplate_identity"]
  );
});

test("a simulated provider outage cannot claim source success", async () => {
  const run = await runSource("web_search", discover, "Oderzo", "TV", {
    searchDetailedFn: async () => ({ outcome: "provider_failed", results: [] }),
  });
  assert.equal(run.manifest.status, "degraded");
  assert.equal(run.manifest.result_count, 0);
  assert.equal(run.manifest.useful_result_count, 0);
  assert.deepEqual(run.manifest.search_outcomes,
    ["provider_failed", "provider_failed", "provider_failed"]);
});

test("bounded gap discovery reports per-template marginal yield", async () => {
  const run = await runSource("web_search", discover, "Oderzo", "TV", {
    queries: [{ id: "postcode_restaurant_menu", query: "\"31046\" ristorante menu" }],
    searchDetailedFn: async () => ({ outcome: "relevant", results: [{
      title: "I migliori ristoranti", url: "https://directory.example/list", snippet: "Oderzo",
    }] }),
  });
  assert.equal(run.manifest.status, "succeeded");
  assert.deepEqual(run.manifest.query_yield, [{
    template_id: "postcode_restaurant_menu",
    query: "\"31046\" ristorante menu",
    outcome: "relevant",
    result_count: 1,
    accepted_candidate_count: 0,
    marginal_candidate_count: 0,
  }]);
  await assert.rejects(() => discover("Oderzo", "TV", {
    queries: Array.from({ length: 5 }, (_, index) => `query ${index}`),
  }), /exceeds four/);
});
