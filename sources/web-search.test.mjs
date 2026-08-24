import test from "node:test";
import assert from "node:assert/strict";
import { extractPageMetadata, extractRestaurantName } from "./web-search.mjs";

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
    address: "Piazzale Europa 4, Oderzo",
    phone: "0422 716104",
  });
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
    phone: "0422.713474",
    address: "Via Garibaldi, 39/A, 31046, Oderzo",
  });
});

test("prefers a restaurant identity over generic website structured data", () => {
  const html = `
    <script type="application/ld+json">{"@type":"WebSite","name":"Pizzeria in centro Oderzo"}</script>
    <script type="application/ld+json">{"@type":"Restaurant","name":"Al Giardinetto"}</script>`;
  assert.equal(extractPageMetadata(html, "Oderzo").name, "Al Giardinetto");
});
