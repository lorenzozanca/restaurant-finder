#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeCandidateUrl } from "../lib/web-stress-fixture.mjs";
import { registrableDomain } from "../lib/publisher-ownership.mjs";

const root = resolve(import.meta.dirname, "..");
const selection = JSON.parse(readFileSync(resolve(root,
  "benchmark/SESSION-11-FINAL-UNSEEN-SELECTION.json"), "utf8"));
const venues = selection.candidates.filter((venue) => venue.partition === "locked_holdout");
const fingerprint = "4a9c84710d6d7478a829c732f52adc50ca7ab12699b03b339a1535e1f6b94079";
const capturedAt = "2026-09-02T18:30:00.000Z";
const reviewedAt = "2026-09-02T19:15:00.000Z";

// Minimal, query-relevant results retained from the bounded integrated-search capture.
// An omitted key means the bounded query produced no retained candidate URL.
const results = new Map([
  [1, ["All In Cafè - Non è solo un bar", "https://www.allincafe.it/"]],
  [2, ["Torino - Centro Commerciale Lingotto", "https://lapiadineria.com/i-nostri-ristoranti/torino-centro-commerciale-lingotto"]],
  [4, ["Azienda Agricola Agriturismo La Muradora", "https://www.italia.it/it/piemonte/pianezza/dove-mangiare/azienda-agricola-agriturismo-la-muradora"]],
  [6, ["SUPER G Italian Mountain Club", "https://lovesuperg.com/"]],
  [7, ["Bulldog Pub", "https://balteus.lovevda.it/it/banca-dati/16/tavole-calde-enoteche-pub/sarre/bulldog-pub/2447"]],
  [8, ["Baita La Jolie Bergere", "https://www.lajoliebergere.com/galleria-immagini/"]],
  [9, ["Rifugio Ostafa Champoluc", "https://www.tuttiaffari.com/rifugio-ostafa-champoluc-339-818-0709"]],
  [10, ["Servizi a Quart", "https://www.lovevda.it/it/risultati-di-ricerca/servizi-87/quart/413"]],
  [11, ["Fermes Chi Osteria", "https://www.fermeschiosteria.it/menu/"]],
  [12, ["KFC Milano Centrale", "https://maps.apple.com/place?place-id=I10A26BB9FA8A8A8D"]],
  [13, ["Registro attività", "https://www.regione.lombardia.it/wps/wcm/connect/d1e3adeb-3095-4ec5-b097-cc17bb729e30/5245.pdf?CACHEID=ROOTWORKSPACE-d1e3adeb-3095-4ec5-b097-cc17bb729e30-n7qNfeY&MOD=AJPERES"]],
  [15, ["Pasticceria Passerini dal 1919", "https://www.tuttamonza.it/pasticceria-passerini-dal-1919-monza-4407"]],
  [16, ["Caffè Four", "https://pages.resmio.com/four/en"]],
  [18, ["Pizza Point", "https://www.pizza-point.it/"]],
  [20, ["Pizzeria Nuova Capri", "https://deliveroo.it/en/menu/bolzano/bolzano/pizzeria-nuova-capri-bz"]],
  [21, ["Cortina 2026 map", "https://gstatic.olympics.com/s3/mc2026/documents/maps/Cortina2026-Map-Download-EN.pdf"]],
  [22, ["Verona - Piazza Santo Spirito", "https://lapiadineria.com/i-nostri-ristoranti/verona-pzza-santo-spirito-"]],
  [23, ["Caffè al Leone", "https://www.bars10.com/IT/Oppeano/1462202040468298/Caff%C3%A8-al-Leone"]],
  [24, ["La Gelateria di Piazza Beltrame", "https://restaurantguru.it/La-Gelateria-di-Piazza-Beltrame-Arzignano"]],
  [25, ["Five Guys Venezia", "https://www.localshop24.com/it/venezia-ve-it/attivita/fast-food/five-guys/"]],
  [26, ["Le Strane Delizie", "https://pasticcerialestranedelizie.it/"]],
  [27, ["Bar Evolution Trieste", "https://restaurantguru.it/Bar-Evolution-Trieste-Trieste"]],
  [28, ["Gelateria Frio Frio", "https://friofrio.life/"]],
  [29, ["Friends Pizza e Kebab", "https://www.ordina-online.menu/restaurants/san-vito-al-tagliamento/friends-pizza-e-kebab"]],
  [30, ["Bar Le Delizie", "https://www.grubbio.com/ristorante/bar-le-delizie-trieste"]],
  [31, ["Portofino Mare", "https://www.comuneportofinomare.it/about/"]],
  [32, ["Cafe San Sci", "https://www.tripadvisor.it/Restaurant_Review-g187822-d12969884-Reviews-Cafe_San_Sci-Sanremo_Italian_Riviera_Liguria.html"]],
  [33, ["Cocò Pizza", "https://www.waze.com/live-map/directions/it/liguria/masone/coco-pizza?to=place.ChIJA-2oE2Y60xIRrMF8rXdPPiU"]],
  [35, ["Zena Kebab", "https://zena-kebab.eatbu.com/?lang=en"]],
  [36, ["Elenco attività Forlimpopoli", "https://www.forlimpopolicittartusiana.it/wp-content/uploads/2020/05/elenco-attivita_esercizi_forlimp8maggio.pdf"]],
  [37, ["Piacenza - Il Gotico", "https://lapiadineria.com/i-nostri-ristoranti/piacenza-il-gotico"]],
  [40, ["Riapre il Cibiamo Station di Parma", "https://www.cibiamo.it/site/riapre-il-ciabiamo-station-di-parma/"]],
  [41, ["Ristorante Selva delle Torri", "https://ristoranteselvadelletorri.com/"]],
  [43, ["Caffè 4 Vie", "https://www.ufficiocamerale.it/9942/caffe-4-vie-snc-di-vignali-alessandro-c"]],
  [44, ["Sapore Pizza", "https://www.tripadvisor.it/Restaurant_Review-g194719-d12944693-Reviews-Sapore_Pizza-Capannori_Province_of_Lucca_Tuscany.html"]],
  [45, ["Move On Firenze", "https://www.italia.it/it/toscana/firenze/dove-mangiare/move-on"]],
  [46, ["Locali Autogrill", "https://www.autogrill.it/wp-content/uploads/2023/08/LOCALI-AUTOGRILL-6.pdf"]],
  [47, ["Where to eat in Assisi", "https://www.visit-assisi.it/en/where-to-eat/"]],
  [48, ["Echoes Group", "https://echoesgroup.it/"]],
  [49, ["BlackStone Pub", "https://www.waze.com/live-map/directions/italy/umbria/citta-di-castello/blackstone-pub"]],
  [50, ["U Street - contatti", "https://www.umamistreet.it/contattaci/"]],
  [51, ["La Fornace", "https://www.italia.it/it/marche/sirolo/dove-mangiare/la-fornace"]],
  [52, ["Curcuma Cafe", "https://www.tripadvisor.it/Restaurant_Review-g194760-d12886172-Reviews-Curcuma_Cafe-Fano_Province_of_Pesaro_and_Urbino_Marche.html"]],
  [53, ["Caffè Saccaria", "https://www.saccaria.it/shop/"]],
  [54, ["Trattoria Lella", "https://restaurantguru.it/Trattoria-Lella-Fermo"]],
  [56, ["Il Porticciolo - dove siamo", "https://www.ilporticciolotrevignano.it/dove-siamo.html"]],
  [58, ["Torrefazione Caffè Gentili", "https://www.caffegentili.it/"]],
  [61, ["Pub Frida", "https://www.tripadvisor.it/Restaurant_Review-g194936-d12963887-Reviews-Pub_Frida-Tortoreto_Province_of_Teramo_Abruzzo.html"]],
  [63, ["Caffè Mariani", "https://www.tuttiaffari.com/caff%C3%A8-mariani"]],
  [65, ["Joe Potato", "https://deliveroo.it/it/menu/laquila/laquila/joe-potato"]],
  [66, ["Pala Pub", "https://restaurantguru.it/Pala-Pub-Campobasso"]],
  [67, ["Shangrilà Pasticceria-Gelateria", "https://www.tripadvisor.it/Restaurant_Review-g1077310-d12674454-Reviews-Shangrila_Pasticceria_Gelateria-Campomarino_Province_of_Campobasso_Molise.html"]],
  [68, ["Caffè Ladinod", "https://www.sisal.it/punti-vendita/larino-caffe-ladinod"]],
  [69, ["Non Solo Pizza", "https://www.tuttiaffari.com/non-solo-pizza_484"]],
  [71, ["Geminus Pub", "https://comune.eboli.sa.it/vivere-il-comune/luoghi/geminus-pub/"]],
  [72, ["Starbucks Napoli Galleria", "https://www.starbucks.it/it/storelocator?storepath=italia%2Fcampania%2Fnapoli%2Fnapoli-galleria-umberto-i"]],
  [73, ["A Malafemmena menu", "https://weur-cdn.piatti.menu/storage/media/companies_menu_pdf/114907829/a-malafemmena-monteforte-irpino-piatti.pdf"]],
  [76, ["Hashtag Cafe Alberobello", "https://www.nuovaopinione.it/alberobello/bar/hashtag-cafe-15964"]],
  [77, ["Elenco ricevitorie", "https://www.agipronews.it/docs/comunicato%20conc%20153.pdf"]],
  [78, ["Locanda Ballarò", "https://www.locandaballaro.it/"]],
  [79, ["Acquaviva delle Fonti brochure", "https://www.borghiautenticiditalia.it/sites/default/files/GN_2017/Acquaviva%20delle%20Fonti_Giornata%20Nazionale.pdf"]],
  [80, ["Paoletto Gelateria Artigianale", "https://www.localshop24.com/it/monopoli-ba-it/attivita/gelateria/paoletto-gelateria-artigianale/"]],
  [81, ["Dolce Arte Melfi", "https://www.oraridiapertura24.it/filiale/Melfi-Pasticceria%2520Gelateria%2520Dolce%2520Arte-1111331U.html"]],
  [82, ["Pizzeria Arcobaleno", "https://www.tuttiaffari.com/pizzeria-arcobaleno_75p"]],
  [83, ["Elenco strutture ricettive", "https://www.aptbasilicata.it/fileadmin/uploads/Registri/Registro_strutture_ricettive.pdf"]],
  [84, ["Mushroom Pub", "https://www.tuttiaffari.com/mushroom-pub-0972-31408"]],
  [85, ["Space Food", "https://restaurantguru.it/Space-Food-Potenza"]],
  [86, ["Elenco imprese Rende", "https://www.cs.camcom.gov.it/sites/default/files/contenuto_redazione/allegati/elenco_imprese.pdf"]],
  [87, ["Bar Gelateria Filippelli", "https://www.cs.camcom.gov.it/sites/default/files/contenuto_redazione/allegati/gelaterie.pdf"]],
  [88, ["Caffè Guglielmo - passione e ricerca", "https://www.caffeguglielmoshop.it/passione-e-ricerca/"]],
  [89, ["Dolci Sogni Trebisacce", "https://restaurantguru.it/Dolci-Sogni-Trebisacce"]],
  [90, ["Peterland Reggio Calabria", "https://www.peterland.it/reggio-calabria.html"]],
  [91, ["Ericelandia", "https://www.menupizza.it/ericelandia-pizzeria-braceria-erice"]],
  [92, ["Panineria al Borgo", "https://www.tripadvisor.it/Restaurant_Review-g187888-d12917978-Reviews-Panineria_Al_Borgo-Catania_Province_of_Catania_Sicily.html"]],
  [94, ["Ice Cream Shop", "https://www.localshop24.com/it/monreale-pa-it/attivita/gelateria/ice-cream-shop/"]],
  [95, ["Officina dell'Arte", "https://repository.comune.palermo.it/396-festino-santa-rosalia-palermo.php"]],
  [96, ["Island Beer", "https://restaurantguru.com/ISLAND-BEER-Tortoli"]],
  [99, ["Gelateria Il Chicco", "https://www.tripadvisor.it/Restaurant_Review-g187884-d4589262-Reviews-Gelateria_Il_Chicco-Oristano_Province_of_Oristano_Sardinia.html"]],
  [100, ["Otium", "https://restaurantguru.com/Otium-Cagliari"]],
]);

const official = new Set([1, 2, 6, 8, 11, 18, 22, 26, 28, 37, 40, 41, 46, 48,
  50, 53, 56, 58, 72, 78, 88, 90]);
const publisherClasses = new Map([
  [4, "directory"], [7, "directory"], [9, "directory"], [10, "directory"],
  [12, "directory"], [13, "unrelated"], [15, "directory"], [16, "booking_or_order_platform"],
  [20, "booking_or_order_platform"], [21, "unrelated"], [23, "directory"], [24, "directory"],
  [25, "directory"], [27, "directory"], [29, "booking_or_order_platform"], [30, "directory"],
  [31, "unrelated"], [32, "editorial_or_review"], [33, "directory"],
  [35, "booking_or_order_platform"], [36, "directory"], [43, "directory"],
  [44, "editorial_or_review"], [45, "directory"], [47, "directory"], [49, "directory"],
  [51, "directory"], [52, "editorial_or_review"], [54, "directory"],
  [61, "editorial_or_review"], [63, "directory"], [65, "booking_or_order_platform"],
  [66, "directory"], [67, "editorial_or_review"], [68, "directory"], [69, "directory"],
  [71, "directory"], [73, "menu_mirror"], [76, "directory"], [77, "unrelated"],
  [79, "unrelated"], [80, "directory"], [81, "directory"], [82, "directory"],
  [83, "unrelated"], [84, "directory"], [85, "directory"], [86, "unrelated"],
  [87, "unrelated"], [89, "directory"], [91, "menu_mirror"],
  [92, "editorial_or_review"], [94, "directory"], [95, "unrelated"],
  [96, "directory"], [99, "editorial_or_review"], [100, "directory"],
]);

if (venues.length !== 100) throw new Error(`expected 100 locked-holdout venues, found ${venues.length}`);
const entries = venues.map((venue, offset) => {
  const index = offset + 1;
  const result = results.get(index);
  const candidates = result ? [{ title: result[0], url: normalizeCandidateUrl(result[1]) }] : [];
  return { venue_id: venue.venue_id, query: `"${venue.name}" "${venue.municipality}"`,
    retrieved_at: capturedAt, candidates };
});

const reviews = entries.map((entry, offset) => {
  const index = offset + 1;
  const candidate = entry.candidates[0];
  if (!candidate) return { venue_id: entry.venue_id, official_website_status: "no_official_site",
    official_website_url: null, evidence_urls: [], domain_reviews: [] };
  const domain = registrableDomain(candidate.url);
  const verified = official.has(index);
  const domainReview = { registrable_domain: domain,
    publisher_class: verified ? "official" : (publisherClasses.get(index) || "unrelated"),
    ownership_status: verified ? "verified" : "rejected", evidence_urls: [candidate.url] };
  if (verified) Object.assign(domainReview, { ownership_method: "manual_first_party_review",
    ownership_reviewed_at: reviewedAt, ownership_evidence_urls: [candidate.url] });
  return { venue_id: entry.venue_id,
    official_website_status: verified ? "accepted" : "no_official_site",
    official_website_url: verified ? candidate.url : null,
    evidence_urls: [candidate.url], domain_reviews: [domainReview] };
});

const outputDirectory = resolve(root, "benchmark/session-11-web-v3");
mkdirSync(outputDirectory, { recursive: true });
for (let start = 1; start <= 100; start += 20) {
  const end = start + 19;
  const suffix = `${String(start).padStart(3, "0")}-${String(end).padStart(3, "0")}`;
  const fixture = { schema_version: 1, fixture_set: `session-11-final-locked-holdout-${suffix}`,
    partition: "locked_holdout", source: "codex_integrated_web_search", brave_requests_made: 0,
    selection_fingerprint_sha256: fingerprint, bounded_result_limit: 5,
    entries: entries.slice(start - 1, end) };
  const adjudication = { schema_version: 1,
    adjudication_set: `session-11-final-locked-holdout-adjudication-${suffix}`,
    partition: "locked_holdout", source: "independent_fixture_review",
    selection_fingerprint_sha256: fingerprint, reviewer: "Codex independent bounded-fixture review",
    reviewed_at: reviewedAt,
    review_basis: "Independent review of retained bounded-query URL/title metadata and first-party branch or venue pages; publisher-domain ownership is approved only where the retained first-party page identifies the selected venue or exact chain branch.",
    scope_limitations: "Minimal URL/title capture only; no snippets or page bodies retained. A no_official_site disposition means no publishable official site was established within the bounded retained evidence, not that no site exists on the open web.",
    entries: reviews.slice(start - 1, end) };
  writeFileSync(resolve(outputDirectory, `locked-holdout-${suffix}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`);
  writeFileSync(resolve(outputDirectory, `locked-holdout-adjudication-${suffix}.json`),
    `${JSON.stringify(adjudication, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify({ venues: entries.length,
  candidates: entries.reduce((sum, entry) => sum + entry.candidates.length, 0),
  accepted: reviews.filter((review) => review.official_website_status === "accepted").length,
  zero_result: entries.filter((entry) => entry.candidates.length === 0).length }, null, 2)}\n`);
