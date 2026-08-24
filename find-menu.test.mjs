import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyWebsite,
  extractRelevantSiteResources,
  scoreSearchCandidate,
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
});

test("keeps an official PDF even when its filename is merely Listino", () => {
  const html = '<a href="/Listino.pdf"><img src="button-123.jpg" alt="Consulta prezzi"></a>';
  const resources = extractRelevantSiteResources(html, "https://pizzaoderzo.it/");
  assert.equal(resources.length, 1);
  assert.equal(resources[0].type, "pdf");
  assert.equal(resources[0].role, "menu");
});
