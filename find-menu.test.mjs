import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyWebsite,
  extractRelevantSiteResources,
  findMenuSources,
  scoreOfficialWebsite,
  scoreSearchCandidate,
  validateResourceCandidate,
} from "./find-menu.mjs";

const oderzo = { name: "Al Giardinetto", type: "ristorante" };

test("rejects a search result with no venue identity evidence", () => {
  const scored = scoreSearchCandidate({
    title: "Cheapest Time to Visit the Maldives",
    snippet: "Save on resort prices during the low season",
    url: "https://atlasranger.com/maldives/cheapest-time-to-visit/",
  }, oderzo, "Oderzo TV");
  assert.equal(scored.accepted, false);
});

test("hard-blocks clearly unsafe and irrelevant result domains", () => {
  const scored = scoreSearchCandidate({
    title: "AI generated videos",
    snippet: "",
    url: "https://www.xvideos.com/?k=ai-generated",
  }, { name: "Il Lucano" }, "Oderzo TV");
  assert.equal(scored.accepted, false);
  assert.deepEqual(scored.reasons, ["blocked_domain"]);
});

test("hard-blocks TheFork from direct and indirect discovery", () => {
  const result = {
    title: "Al Giardinetto - Oderzo",
    snippet: "Ristorante a Oderzo",
    url: "https://www.thefork.it/ristorante/al-giardinetto-r12345",
  };
  const scored = scoreSearchCandidate(result, oderzo, "Oderzo TV");
  assert.equal(classifyWebsite(result.url), "blocked");
  assert.equal(scored.accepted, false);
  assert.deepEqual(scored.reasons, ["blocked_domain"]);
});

test("rejects a namesake business without restaurant or location context", () => {
  const scored = scoreSearchCandidate({
    title: "Marmitte sportive auto - Scarichi sportivi | Ragazzon",
    snippet: "Silenziatori in acciaio inox per automobili",
    url: "https://www.ragazzon.com/it",
  }, { name: "Ragazzon" }, "Oderzo TV");
  assert.equal(scored.accepted, false);
});

test("does not promote a local namesake school as the official venue site", () => {
  const scored = scoreSearchCandidate({
    title: "La Scuola - Sansovino.edu.it",
    snippet: "Istituto tecnico J. Sansovino di Oderzo",
    url: "https://www.sansovino.edu.it/la-scuola/",
  }, { name: "Al Sansovino" }, "Oderzo TV");
  assert.equal(scored.officialCandidate, false);
});

test("accepts a strongly identified official venue website", () => {
  const scored = scoreSearchCandidate({
    title: "Gatto Nero Pub | Birreria e Snack Bar a Oderzo",
    snippet: "Gatto Nero Pub, locale a Oderzo in provincia di Treviso",
    url: "https://gattoneropub.it/",
  }, { name: "Gatto Nero", type: "pub" }, "Oderzo TV");
  assert.equal(scored.accepted, true);
  assert.equal(scored.officialCandidate, true);
  assert.equal(scored.confidence, "high");
  assert.deepEqual(scored.scores, { identity: 100, geography: 70, officialness: 65 });
  assert.equal(scored.official_outcome, "accepted");
});

test("accepts an Overture-provided fully branded domain from strong local structured identity", () => {
  const decision = scoreOfficialWebsite({
    url: "https://ristorantegrancasa.test/",
    known: true,
    crawl: { final_url: "https://ristorantegrancasa.test/", resources: [], site_facts: { text: "" } },
  }, {
    name: "Gran Casa", sources: ["nominatim", "overture_places"],
    address: "Piazza C. Stefanel 2, 31046 Oderzo", phone: "+390422814571",
  }, { municipality: "Oderzo", province_code: "TV", postcodes: ["31046"] });
  assert.equal(decision.outcome, "accepted");
  assert.ok(decision.reasons.includes("source_provided_website"));
});

test("rejects an exact-name official-looking result in the wrong municipality", () => {
  const scored = scoreOfficialWebsite({
    title: "Gatto Nero Pub | Milano",
    snippet: "Gatto Nero, pub e birreria nel centro di Milano",
    url: "https://gattoneropub.it/",
  }, { name: "Gatto Nero", type: "pub" }, "Oderzo TV");
  assert.equal(scored.outcome, "rejected");
  assert.equal(scored.scores.identity, 100);
  assert.equal(scored.scores.geography, 0);
  assert.ok(scored.reasons.includes("geography_contradiction"));
});

test("rejects a cross-domain canonical even when page identity otherwise matches", () => {
  const scored = scoreOfficialWebsite({
    url: "https://locandadussin.test/oderzo",
    crawl: {
      final_url: "https://locandadussin.test/oderzo",
      resources: [{ url: "https://locandadussin.test/menu" }],
      site_facts: {
        text: "Locanda Dussin, ristorante a Oderzo",
        canonical_url: "https://unrelated-hotel.test/restaurant",
        structured_types: ["Restaurant"],
        phones: "",
      },
    },
  }, { name: "Locanda Dussin" }, "Oderzo TV");
  assert.equal(scored.outcome, "rejected");
  assert.ok(scored.reasons.includes("cross_domain_canonical"));
});

test("accepts a changed redirect domain only with exact venue and branch geography", () => {
  const scored = scoreOfficialWebsite({
    url: "http://old.example/roma",
    crawl: {
      final_url: "https://new.example/locations/roma-centro",
      resources: [],
      site_facts: {
        text: "Fixture Roma Centro, ristorante nel Municipio I di Roma",
        canonical_url: "https://new.example/locations/roma-centro",
        structured_types: ["Restaurant"],
        phones: "",
      },
    },
  }, { name: "Fixture Roma Centro" }, "Roma RM");
  assert.equal(scored.outcome, "accepted");
  assert.equal(scored.url, "https://new.example/locations/roma-centro");
  assert.ok(scored.reasons.includes("redirect_domain_changed"));
});

test("holds an identity match without geography or business evidence for review", () => {
  const scored = scoreOfficialWebsite({
    title: "Locanda Dussin — Home",
    snippet: "Benvenuti nel sito ufficiale",
    url: "https://locandadussin.it/",
  }, { name: "Locanda Dussin" }, "Oderzo TV");
  assert.equal(scored.outcome, "review");
  assert.deepEqual(scored.scores, { identity: 100, geography: 0, officialness: 45 });
});

test("accepts a relevant directory listing as a non-official candidate", () => {
  const scored = scoreSearchCandidate({
    title: "Al Bivio a Oderzo - Pizzeria",
    snippet: "Al Bivio, ristorante e pizzeria a Oderzo",
    url: "https://www.paginebianche.it/scheda/albivio-oderzo",
  }, { name: "Al Bivio", type: "pizzeria" }, "Oderzo TV");
  assert.equal(scored.accepted, true);
  assert.equal(scored.officialCandidate, false);
  assert.equal(classifyWebsite("https://www.paginebianche.it/scheda/albivio-oderzo"), "directory");
  assert.equal(classifyWebsite("https://piatti.menu/restaurants/oderzo/barhacca"), "directory");
  assert.equal(classifyWebsite("https://it.tripadvisor.ch/Restaurant_Review-example"), "directory");
});

test("keeps focused menu, order, specialty, and context-supported image links", () => {
  const html = `
    <nav>
      <a href="/privacy-policy/">Privacy</a>
      <a href="/login">Login</a>
    </nav>
    <main>
      <a href="/menu-ristorante/">Carta del ristorante</a>
      <a href="/ordina/">Ordina online</a>
      <a href="/specialita-pesce/">Specialità di pesce</a>
      <a href="/gallery/">Gallery</a>
      <section>Guarda il nostro menu di cucina stagionale
        <img src="/uploads/IMG_2048.jpg" alt="Piatti della stagione">
      </section>
      <img src="/assets/logo.svg" alt="Restaurant logo">
    </main>`;
  const resources = extractRelevantSiteResources(html, "https://example.test/");
  assert.deepEqual(resources.map((item) => item.url), [
    "https://example.test/menu-ristorante/",
    "https://example.test/ordina/",
    "https://example.test/specialita-pesce/",
    "https://example.test/uploads/IMG_2048.jpg",
  ]);
  assert.equal(resources.at(-1).confidence, "low");
  assert.equal(resources[0].source_url, "https://example.test/");
  assert.deepEqual(resources[0].evidence, ["same_official_domain", "menu_anchor"]);
});

test("treats menu routes on ordering platforms as order resources", () => {
  const html = '<a href="/menus/dolci">Dolci</a>';
  const resources = extractRelevantSiteResources(html, "https://pizza-smile.order.dish.co/");
  assert.equal(resources.length, 1);
  assert.equal(resources[0].role, "order");

  const decision = validateResourceCandidate(resources[0], { name: "Pizza Smile" }, "Trieste TS",
    "https://pizza-smile.order.dish.co/", {
      ok: true,
      status: 200,
      final_url: "https://pizza-smile.order.dish.co/menus/dolci",
      content_type: "text/html",
      body: "<title>Pizza Smile - Dolci</title><h1>Pizza Smile</h1>",
    });
  assert.equal(decision.status, "accepted");
  assert.equal(decision.role, "order");
  assert.equal(decision.resource.role_evidence.source, "ordering_surface");
});

test("keeps an official PDF even when its filename is merely Listino", () => {
  const html = '<a href="/Listino.pdf"><img src="button-123.jpg" alt="Consulta prezzi"></a>';
  const resources = extractRelevantSiteResources(html, "https://pizzaoderzo.it/");
  assert.equal(resources.length, 1);
  assert.equal(resources[0].type, "pdf");
  assert.equal(resources[0].role, "menu");
  assert.deepEqual(resources[0].evidence, ["same_official_domain", "pdf_url"]);
});

test("extracts an ordering page linked by the official website on an external domain", () => {
  const resources = extractRelevantSiteResources(
    '<a href="https://orders.example.test/al-bivio">Ordina online</a>',
    "https://albivio.test/",
  );
  assert.equal(resources.length, 1);
  assert.equal(resources[0].role, "order");
  assert.deepEqual(resources[0].evidence, ["linked_from_official_site", "order_anchor"]);
});

test("keeps table booking distinct from food ordering", () => {
  const resources = extractRelevantSiteResources(
    '<a href="https://booking.example.test/table/fixture">Prenota il tuo tavolo</a>',
    "https://fixture.test/",
  );
  assert.equal(resources.length, 1);
  assert.equal(resources[0].role, "booking");
});

test("retains an uncertain external resource for review instead of publishing it", () => {
  const decision = validateResourceCandidate({
    url: "https://delivery.test/order/123",
    role: "order",
    label: "Ordina online",
  }, { name: "Al Bivio" }, "Oderzo TV", "https://albivio.test/", {
    ok: true,
    status: 200,
    final_url: "https://delivery.test/order/123",
    content_type: "text/html",
    body: "Ordina online",
  });
  assert.equal(decision.status, "review");
  assert.equal(decision.role, "order");
});

test("deduplicates tracking variants before resource validation", async () => {
  let resourceChecks = 0;
  const result = await findMenuSources({
    name: "Al Bivio",
    website: "https://albivio.test/",
  }, "Oderzo TV", {
    crawlCache: new Map(),
    get: async (url) => {
      if (url.includes("/menu")) resourceChecks++;
      return {
        ok: true,
        status: 200,
        final_url: url,
        content_type: "text/html",
        body: url === "https://albivio.test/"
          ? `${"Al Bivio, ristorante a Oderzo. ".repeat(10)}<a href="/menu?utm_source=a">Menu</a><a href="/menu?utm_source=b">Menu completo</a>`
          : "Al Bivio Oderzo menu completo",
      };
    },
    getRendered: async () => ({ ok: false, body: "" }),
    search: async () => [],
  });
  assert.equal(resourceChecks, 1);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resource_decisions.length, 1);
});

test("crawls a useful known website without issuing a search", async () => {
  let searchCalls = 0;
  const result = await findMenuSources({
    name: "Al Giardinetto",
    website: "https://giardinetto.test/",
    provenance: { website: [{ source: "nominatim", origin: "osm_tag" }] },
  }, "Oderzo TV", {
    crawlCache: new Map(),
    get: async () => ({
      ok: true,
      body: `<main>${"Al Giardinetto, ristorante a Oderzo. ".repeat(10)}<a href="/menu/">Menu</a></main>`,
    }),
    getRendered: async () => ({ ok: false, body: "" }),
    search: async () => { searchCalls++; return []; },
  });

  assert.equal(searchCalls, 0);
  assert.equal(result.website, "https://giardinetto.test/");
  assert.deepEqual(result.resources.map((item) => item.url), ["https://giardinetto.test/menu/"]);
  assert.equal(result.enrichment_run.strategy, "website_first");
  assert.equal(result.enrichment_run.resolver_status, "accepted");
  assert.equal(result.enrichment_run.resolver_stop_reason, "official_site_accepted");
  assert.deepEqual(result.enrichment_run.resolver_budget,
    { searches: 1, crawls: 3, budget_escalation_reason: undefined });
  assert.equal(result.enrichment_run.crawl_requests, 1);
  assert.equal(result.enrichment_run.crawl_attempts.length, 1);
  assert.equal(result.enrichment_run.search_requests, 0);
  assert.deepEqual(result.enrichment_run.search_attempts, []);
  assert.equal(result.enrichment_run.resource_validation_requests, 1);
});

test("keeps an accepted known website with no resources without an identity search", async () => {
  const searchQueries = [];
  const result = await findMenuSources({
    name: "Locanda Dussin",
    website: "https://dussin.test/",
  }, "Oderzo TV", {
    crawlCache: new Map(),
    get: async (url) => ({
      ok: true,
      body: url.endsWith(".xml")
        ? "<urlset></urlset>"
        : `<main>${"Locanda Dussin, ristorante a Oderzo. ".repeat(12)}</main>`,
    }),
    getRendered: async () => ({ ok: false, body: "" }),
    search: async (query) => { searchQueries.push(query); return []; },
  });

  assert.deepEqual(searchQueries, ["site:dussin.test (menu OR menù OR carta OR ordina OR asporto)"]);
  assert.equal(result.website, "https://dussin.test/");
  assert.deepEqual(result.resources, []);
  assert.equal(result.enrichment_run.search_requests, 0);
  assert.equal(result.enrichment_run.resource_site_search_requests, 1);
  assert.equal(result.enrichment_run.resolver_stop_reason, "official_site_accepted");
});

test("pre-caps validation with role diversity and reports per-stage drops", async () => {
  const checked = [];
  const links = Array.from({ length: 10 }, (_, index) => `<a href="/menu-${index}">Menu ${index}</a>`).join("")
    + '<a href="/carta-vini">Carta vini</a><a href="/ordina">Ordina</a><a href="/specialita">Specialità</a>';
  const result = await findMenuSources({ name: "Fixture", website: "https://fixture.test/" }, "Oderzo TV", {
    referenceDate: "2026-08-27T00:00:00Z",
    crawlCache: new Map(),
    get: async (url, options) => {
      if (url !== "https://fixture.test/") checked.push({ url, maxBytes: options.maxBytes });
      return { ok: true, status: 200, final_url: url, content_type: "text/html",
        body: url === "https://fixture.test/"
          ? `${"Fixture ristorante a Oderzo. ".repeat(10)}${links}`
          : "<title>Fixture menu Oderzo</title><h1>Menu</h1>" };
    },
    getRendered: async () => ({ ok: false, body: "" }),
    search: async () => [],
  });
  assert.equal(checked.length, 8);
  assert.ok(checked.some((item) => item.url.endsWith("/carta-vini")));
  assert.ok(checked.some((item) => item.url.endsWith("/ordina")));
  assert.ok(checked.some((item) => item.url.endsWith("/specialita")));
  assert.equal(checked.length < 13, true);
  assert.deepEqual([...new Set(result.resources.map((item) => item.role))].sort(),
    ["drinks", "menu", "order", "specialty"]);
  assert.equal(result.enrichment_run.resource_stage_metrics.totals.pre_cap_dropped, 5);
  assert.equal(result.enrichment_run.resource_validation_requests, 8);
  assert.equal(result.enrichment_run.resource_stage_metrics.by_role.order.accepted, 1);
  assert.equal(result.enrichment_run.resource_stage_metrics.totals.post_cap_dropped, 2);
});

test("tries a declared sitemap first and stops after it yields a resource", async () => {
  const requests = [];
  const result = await findMenuSources({ name: "Fixture", website: "https://fixture.test/" }, "Oderzo TV", {
    crawlCache: new Map(),
    get: async (url, options) => {
      requests.push({ url, maxBytes: options.maxBytes });
      if (url.endsWith("/feeds/venue.xml")) return { ok: true, status: 200,
        body: "<urlset><url><loc>https://fixture.test/menu</loc></url></urlset>" };
      if (url.endsWith("/menu")) return { ok: true, status: 200, final_url: url,
        content_type: "text/html", body: "<title>Fixture menu</title><h1>Menu</h1>" };
      return { ok: true, status: 200, final_url: url, content_type: "text/html",
        body: `${"Fixture ristorante a Oderzo. ".repeat(10)}<link rel="sitemap" href="/feeds/venue.xml">` };
    },
    getRendered: async () => ({ ok: false, body: "" }),
    search: async () => { throw new Error("site search should not run"); },
  });
  assert.deepEqual(requests.map((item) => item.url), [
    "https://fixture.test/", "https://fixture.test/feeds/venue.xml", "https://fixture.test/menu",
  ]);
  assert.equal(result.enrichment_run.resource_discovery_requests, 1);
  assert.equal(result.enrichment_run.resource_site_search_requests, 0);
  assert.equal(requests[1].maxBytes, 256_000);
});

test("uses one domain-restricted fallback after empty sequential sitemaps", async () => {
  const searches = [];
  const result = await findMenuSources({ name: "Fixture", website: "https://fixture.test/" }, "Oderzo TV", {
    crawlCache: new Map(),
    get: async (url) => {
      if (url.endsWith(".xml")) return { ok: true, status: 200, body: "<urlset></urlset>" };
      if (url.endsWith("/menu-corrente")) return { ok: true, status: 200, final_url: url,
        content_type: "text/html", body: "<title>Menu Fixture</title><h1>Menu alla carta</h1>" };
      return { ok: true, status: 200, final_url: url, content_type: "text/html",
        body: `${"Fixture ristorante a Oderzo. ".repeat(10)}` };
    },
    getRendered: async () => ({ ok: false, body: "" }),
    search: async (query) => {
      searches.push(query);
      return [{ title: "Menu corrente", snippet: "Menu alla carta", url: "https://fixture.test/menu-corrente" }];
    },
  });
  assert.equal(searches.length, 1);
  assert.deepEqual(result.resources.map((item) => item.url), ["https://fixture.test/menu-corrente"]);
  assert.equal(result.enrichment_run.resource_discovery_requests, 2);
  assert.equal(result.enrichment_run.resource_site_search_requests, 1);
});

test("keeps strong anchor and URL role when page-wide text mentions another role", () => {
  const decision = validateResourceCandidate({
    url: "https://fixture.test/menu", role: "menu", label: "Menu alla carta",
    evidence: ["same_official_domain", "menu_anchor"], found_via: "official_website",
  }, { name: "Fixture" }, "Oderzo TV", "https://fixture.test/", {
    ok: true, status: 200, final_url: "https://fixture.test/menu", content_type: "text/html",
    body: "<title>Le nostre specialità</title><h1>Specialità alla brace</h1>",
  }, { referenceDate: "2026-08-27T00:00:00Z" });
  assert.equal(decision.role, "menu");
  assert.equal(decision.resource.role_evidence.source, "anchor_url");
  assert.ok(decision.evidence.includes("role_from_anchor_url"));
});

test("reviews or rejects stale dated resources while retaining stable undated menus", () => {
  const base = { ok: true, status: 200, content_type: "application/pdf", body: "" };
  const stale = validateResourceCandidate({ url: "https://fixture.test/menu-estate-2024.pdf", role: "menu" },
    { name: "Fixture" }, "Oderzo TV", "https://fixture.test/",
    { ...base, final_url: "https://fixture.test/menu-estate-2024.pdf" },
    { referenceDate: "2026-08-27T00:00:00Z" });
  const previous = validateResourceCandidate({ url: "https://fixture.test/menu-2025.pdf", role: "menu" },
    { name: "Fixture" }, "Oderzo TV", "https://fixture.test/",
    { ...base, final_url: "https://fixture.test/menu-2025.pdf" },
    { referenceDate: "2026-08-27T00:00:00Z" });
  const stable = validateResourceCandidate({ url: "https://fixture.test/menu.pdf", role: "menu" },
    { name: "Fixture" }, "Oderzo TV", "https://fixture.test/",
    { ...base, final_url: "https://fixture.test/menu.pdf" },
    { referenceDate: "2026-08-27T00:00:00Z" });
  assert.equal(stale.status, "rejected");
  assert.equal(stale.freshness, "stale");
  assert.equal(previous.status, "review");
  assert.equal(stable.status, "accepted");
  assert.equal(stable.freshness, "undated");
});

test("does not treat unrelated years in stable HTML as a resource edition date", () => {
  const decision = validateResourceCandidate({ url: "https://fixture.test/menu/", role: "menu" },
    { name: "Fixture" }, "Oderzo TV", "https://fixture.test/",
    { ok: true, status: 200, final_url: "https://fixture.test/menu/", content_type: "text/html",
      body: "<title>Fixture menu</title><footer>Dal 2000 · copyright 2025</footer>" },
    { referenceDate: "2026-08-27T00:00:00Z" });
  assert.equal(decision.status, "accepted");
  assert.equal(decision.freshness, "undated");
});

test("classifies editorial and business-list pages as directories", () => {
  for (const url of ["https://places2.com/place/example", "https://www.guidotommasi.it/news/example",
    "https://eccellenze.oggitreviso.it/example", "http://telefono-societa.it/elenco/example",
    "https://cronachedigusto.it/dove-mangio/example", "https://www.touringclub.it/destinazioni/example",
    "https://it.lacaseranevegal.it/agriturismo/example", "http://www.enrosadira.it/friuli/example.htm"]) {
    assert.equal(classifyWebsite(url), "directory");
  }
});

test("classifies every Session 10 official-website false-positive host as a directory", () => {
  const urls = [
    "https://vivimilano.corriere.it/ristoranti/gelaterie/latteneve/",
    "https://mindtrip.ai/restaurant/portofino-liguria/gelateria-bar-san-giorgio/re-Qt53Sbsd",
    "https://www.trivago.it/it/oar/aparthotel-studio-barca-bologna",
    "https://www.informazione-aziende.it/Azienda_BAR-FIRENZE",
    "https://wanderme.net/en/poi/pizzeria-il-grottino/21347",
    "https://0742651426.telefono.click/example.html",
    "https://www.rivieraconero.com/scopri/trattoria-bar-belvedere/",
    "https://www.prontoatutto.it/attivita/the-clifton/",
    "https://www.roma03.net/salviamo-il-bivacco/",
    "https://www.nuovaopinione.it/alberobello/pub/pub-crash-398679",
    "https://iltaccodibacco.it/puglia/eventi/58956.html",
    "https://pizza.top10posti.it/041380/Pizzeria_Pino_Loricato_Civita",
    "https://www.happycow.net/reviews/gelateria-liparoti-erice-429004",
    "https://www.hotel-trapani.com/ristorante/trapani/176-Pizzeria-La-Rustica",
  ];
  assert.equal(urls.length, 14);
  for (const url of urls) assert.equal(classifyWebsite(url), "directory", url);
});

test("classifies every fresh-pilot directory false-positive host as a directory", () => {
  for (const url of [
    "https://ristoranti.giallozafferano.it/ristoranti/valle-d-aosta/example.html",
    "https://venue.grubbio.com/", "https://regione-liguria.opendi.it/example.html",
    "https://venue.res-menu.net/menu", "https://www.mycia.it/menu/example",
    "https://mapstr.com/place/example",
  ]) assert.equal(classifyWebsite(url), "directory", url);
});

test("requires first-party evidence before publishing a matching venue page", () => {
  const scored = scoreOfficialWebsite({
    url: "https://publisher.test/guide/fixture-oderzo",
    title: "Fixture Oderzo",
    snippet: "Fixture ristorante a Oderzo, telefono 0422 123456",
    crawl: {
      final_url: "https://publisher.test/guide/fixture-oderzo",
      resources: [],
      site_facts: {
        text: "Fixture ristorante a Oderzo, telefono 0422 123456",
        canonical_url: "https://publisher.test/guide/fixture-oderzo",
        structured_types: [],
        phones: "0422 123456",
      },
    },
  }, { name: "Fixture", phone: "+39 0422 123456" }, "Oderzo TV");
  assert.equal(scored.outcome, "review");
});

test("rejects editorial schema even when an article repeats venue identity", () => {
  const scored = scoreOfficialWebsite({
    url: "https://publisher.test/news/fixture-oderzo",
    crawl: {
      final_url: "https://publisher.test/news/fixture-oderzo",
      resources: [],
      site_facts: {
        text: "Fixture ristorante a Oderzo, telefono 0422 123456",
        canonical_url: "https://publisher.test/news/fixture-oderzo",
        structured_types: ["BlogPosting", "Restaurant"],
        phones: "0422 123456",
      },
    },
  }, { name: "Fixture", phone: "+39 0422 123456" }, "Oderzo TV");
  assert.equal(scored.outcome, "rejected");
  assert.ok(scored.reasons.includes("structured_editorial_data"));
});

test("rejects non-food card articles and editorial resource paths", () => {
  const response = (url, body) => ({ ok: true, status: 200, final_url: url,
    content_type: "text/html", body });
  const fuel = validateResourceCandidate({ url: "https://energy.test/articolo-02/", role: "menu",
    label: "Un'unica carta carburanti" }, { name: "Energybar" }, "Oderzo TV", "https://energy.test/",
  response("https://energy.test/articolo-02/", "Energybar Oderzo carta carburanti"));
  const blog = validateResourceCandidate({ url: "https://fixture.test/taccuino/vino", role: "drinks",
    label: "Viaggi di vino" }, { name: "Fixture" }, "Oderzo TV", "https://fixture.test/",
  response("https://fixture.test/taccuino/vino", "Fixture Oderzo vino"));
  assert.notEqual(fuel.status, "accepted");
  assert.equal(blog.status, "rejected");
  assert.ok(blog.evidence.includes("editorial_resource"));
});

test("rejects sibling resources outside an official branch path", () => {
  const decision = validateResourceCandidate({ url: "https://group.test/sibling-order", role: "order",
    label: "Ordina Sibling" }, { name: "Target" }, "Oderzo TV", "https://group.test/target.php",
  { ok: true, status: 200, final_url: "https://group.test/sibling-order", content_type: "text/html",
    body: "Sibling Oderzo ordina" });
  assert.equal(decision.status, "rejected");
  assert.ok(decision.evidence.includes("branch_identity_missing"));
});

test("accepts an exact branded website supplied with structured OSM contact facts", () => {
  const decision = scoreOfficialWebsite({ url: "https://ginsushi.test/", known: true,
    crawl: { final_url: "https://ginsushi.test/", site_facts: { text: "Gin Sushi" } } },
  { name: "Gin Sushi", phone: "+390422207511", sources: ["nominatim"] }, "Oderzo TV");
  assert.equal(decision.outcome, "accepted");
});

test("official-site searches retain a multiword municipality and use aliases", async () => {
  const queries = [];
  await findMenuSources({ name: "Giardinetto", aliases: ["Giardinetto", "Al Giardinetto"] }, {
    municipality: "Motta di Livenza", province_code: "TV", country_code: "IT", postcodes: ["31045"],
  }, {
    crawlCache: new Map(),
    get: async () => ({ ok: false, status: 404, body: "" }),
    getRendered: async () => ({ ok: false, body: "" }),
    search: async (query) => { queries.push(query); return []; },
  });
  assert.equal(queries[0], '"Giardinetto" "Motta di Livenza" "31045"');
  assert.ok(queries.every((query) => query.includes("Motta di Livenza")));
  assert.ok(queries.every((query) => !query.includes('"Motta" ristorante')));
});

test("does not publish resources from a source-provided website that resolves to the wrong city", async () => {
  const result = await findMenuSources({
    name: "Gatto Nero",
    website: "https://gattonero-wrong.test/",
  }, "Oderzo TV", {
    crawlCache: new Map(),
    get: async (url) => url.includes("sitemap")
      ? { ok: false, status: 404, body: "", final_url: url }
      : {
          ok: true,
          status: 200,
          final_url: "https://gattonero-wrong.test/milano",
          body: `<main>${"Gatto Nero, ristorante e pub a Milano. ".repeat(10)}<a href="/menu">Menu</a></main>`,
        },
    getRendered: async () => ({ ok: false, body: "" }),
    search: async () => [],
  });
  assert.equal(result.website, undefined);
  assert.deepEqual(result.resources, []);
  assert.equal(result.website_decision.status, "rejected");
  assert.ok(result.website_decision.evidence.includes("geography_contradiction"));
});

test("selects Barhacca's official site from a later search rank", async () => {
  const result = await findMenuSources({ name: "Barhacca", postcode: "31046" }, {
    municipality: "Oderzo", province_code: "TV", country_code: "IT", postcodes: ["31046"],
  }, {
    crawlCache: new Map(),
    search: async () => [
      { title: "Barhacca Hotel Roma", snippet: "Hotel e camere a Roma", url: "https://wrong-barhacca.test/" },
      { title: "Directory", snippet: "", url: "https://www.paginebianche.it/barhacca" },
      { title: "Unrelated", snippet: "", url: "https://unrelated-one.test/" },
      { title: "Unrelated", snippet: "", url: "https://unrelated-two.test/" },
      { title: "Unrelated", snippet: "", url: "https://unrelated-three.test/" },
      { title: "Unrelated", snippet: "", url: "https://unrelated-four.test/" },
      { title: "Barhacca | Bar e paninoteca", snippet: "Barhacca a Oderzo, ristorante e paninoteca",
        url: "https://www.barhacca.test/" },
    ],
    get: async (url) => url.endsWith(".xml")
      ? { ok: false, status: 404, body: "", final_url: url }
      : { ok: true, status: 200, final_url: url,
          body: `${"Barhacca, bar ristorante e paninoteca a Oderzo. ".repeat(12)}` },
    getRendered: async () => ({ ok: false, body: "" }),
  });
  assert.equal(result.website, "https://www.barhacca.test/");
  assert.equal(result.enrichment_run.crawl_attempts[0].search_rank, 7);
  assert.equal(result.enrichment_run.resolver_status, "accepted");
});

test("reuses a canonical homepage crawl across aliases but keeps branch pages separate", async () => {
  const crawlCache = new Map();
  let getCalls = 0;
  const options = {
    crawlCache,
    get: async (url) => {
      getCalls++;
      const identity = url.includes("/treviso") ? "Example Treviso, ristorante a Treviso"
        : url.includes("/oderzo") ? "Example Oderzo, ristorante a Oderzo"
        : "Ca Lozzio, ristorante a Oderzo";
      return {
        ok: true,
        body: `<link rel="canonical" href="${url}">
          <script type="application/ld+json">{"@type":"Restaurant"}</script>
          <main>${`${identity}. `.repeat(10)}<a href="/menu.pdf">Menu PDF</a></main>`,
      };
    },
    getRendered: async () => ({ ok: false, body: "" }),
    search: async () => { throw new Error("search should not run"); },
  };

  const first = await findMenuSources({ name: "Ca' Lozzio", website: "http://www.example.test/" }, "Oderzo", options);
  const alias = await findMenuSources({ name: "Ca'Lozzio", website: "https://example.test/" }, "Oderzo", options);
  await findMenuSources({ name: "Example Treviso", website: "https://example.test/treviso" }, "Treviso", options);
  await findMenuSources({ name: "Example Oderzo", website: "https://example.test/oderzo" }, "Oderzo", options);

  assert.equal(first.enrichment_run.crawl_cache_hits, 0);
  assert.equal(alias.enrichment_run.crawl_cache_hits, 1);
  assert.equal(getCalls, 7);
});
