import { search } from "../lib/search.mjs";

export async function discover(town) {
  const queries = [
    `ristoranti ${town} sito web`,
    `trattoria pizzeria ${town}`,
  ];

  const all = [];
  for (const q of queries) {
    const results = await search(q, 12);
    for (const r of results) {
      all.push(r);
    }
  }

  const restaurants = [];
  for (const r of all) {
    const name = extractRestaurantName(r.title, r.snippet);
    if (!name) continue;

    const isList = isListingPage(r.title, r.snippet, r.url);
    if (isList) continue;

    restaurants.push({
      name,
      type: guessType(r.title, r.snippet),
      address: "",
      website: r.url,
      phone: undefined,
      source: "web_search",
      snippet: r.snippet,
    });
  }

  return restaurants;
}

function extractRestaurantName(title, snippet) {
  const combined = `${title} ${snippet}`.toLowerCase();
  const patterns = [
    /(?:ristorante|trattoria|pizzeria|osteria|bar|enoteca)\s+([A-ZÀ-Ü][a-zà-ü']+(?:\s+[A-ZÀ-Üa-zà-ü']+){0,3})\b/i,
  ];

  for (const p of patterns) {
    const m = title.match(p) || snippet.match(p);
    if (m) return capitalize(m[1]);
  }

  const titleClean = title
    .replace(/\s*[-–|]\s*.*$/, "")
    .replace(/^(?:Ristorante|Trattoria|Pizzeria|Osteria|Bar)\s+/i, "")
    .trim();

  if (titleClean.length > 3 && titleClean.length < 50 && /\s/.test(titleClean)) {
    return capitalize(titleClean);
  }

  return null;
}

function isListingPage(title, snippet, url) {
  const combined = `${title} ${snippet}`.toLowerCase();
  const urlLower = (url || "").toLowerCase();

  const urlBlock = [
    "paginegialle.it", "guide.michelin.com",
    "tripadvisor.it", "tripadvisor.com",
    "tuttocitta.it", "italia.it",
    "restaurantguru", "sluurpy",
    "facebook.com", "instagram.com",
    "thefork", "google.com/maps",
    "pagina-inizio.com",
    "paginebianche.it", "reteimprese.it", "visitcopenhagen",
    "piatti.menu/list", "piatti.menu/restaurants",
  ];
  if (urlBlock.some((d) => urlLower.includes(d))) return true;

  const indicators = [
    "migliori ristoranti", "i migliori", "migliori pizzerie",
    "top 10", "top 15", "guida ai", "dove mangiare",
    "ristoranti a ", "pizzerie a ", "trattorie a ", "osterie a ",
    "classifica", "recensioni", "i 10 migliori", "i 5 migliori",
    "elenco", "lista dei", "cerca in zona", "aggiornamento al ",
    "the fork", "tripadvisor", "google maps", "pagine gialle",
    "pagina iniziale", "le migliori", "scopri i migliori",
    "mappa dei ristoranti", "mappa ristoranti", "mappa dei",
    "ricerca ristoranti",
    "indirizzi e orari", "orari di apertura",
    "top ristoranti", "migliori ristoranti",
  ];
  return indicators.some((w) => combined.includes(w));
}

function guessType(title, snippet) {
  const combined = `${title} ${snippet}`.toLowerCase();
  if (combined.includes("pizzeria")) return "pizzeria";
  if (combined.includes("trattoria")) return "trattoria";
  if (combined.includes("osteria")) return "osteria";
  if (combined.includes("bar ")) return "bar";
  if (combined.includes("enoteca")) return "enoteca";
  if (combined.includes("ristorante")) return "restaurant";
  return "restaurant";
}

function capitalize(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}