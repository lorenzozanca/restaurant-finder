import { search } from "../lib/search.mjs";

const TOWN_SLUG_REGIONS = [
  "abruzzo", "basilicata", "calabria", "campania", "emilia-romagna",
  "friuli-venezia-giulia", "lazio", "liguria", "lombardia", "marche",
  "molise", "piemonte", "puglia", "sardegna", "sicilia", "toscana",
  "trentino-alto-adige", "umbria", "valle-d-aosta", "veneto",
  "friuli-venezia giulia",
];

export async function discover(town) {
  const normalized = town.toLowerCase().replace(/\s+/g, "-");
  const seen = new Set();
  const restaurants = [];

  const queries = [
    `site:paginegialle.it ${town} ristorante`,
    `site:paginegialle.it ${town} pizzeria`,
    `site:paginegialle.it ${town} trattoria`,
  ];

  for (const q of queries) {
    const results = await search(q, 20);
    if (results.length === 0) continue;

    for (const r of results) {
      if (isCategoryPage(r.url)) continue;
      if (!isIndividualRestaurant(r.url)) continue;

      const key = extractUrlKey(r.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const name = extractName(r.title, r.url, town);
      if (!name || name.length < 3 || name.length > 50) continue;

      const type = extractType(r.url, r.title);
      const address = extractAddress(r.title, town);

      restaurants.push({
        name,
        type,
        address,
        website: r.url,
        source: "paginegialle",
      });
    }
  }

  return restaurants;
}

function isCategoryPage(url) {
  for (const region of TOWN_SLUG_REGIONS) {
    if (url.includes(`/${region}/`)) return true;
  }
  if (url.endsWith(".html")) return true;
  return false;
}

function isIndividualRestaurant(url) {
  return /paginegialle\.it\/(?!veneto\/|lombardia\/|lazio\/|campania\/|sicilia\/|puglia\/|emilia-romagna\/|toscana\/|piemonte\/|calabria\/|sardegna\/|liguria\/|marche\/|abruzzo\/|friuli-venezia-giulia\/|umbria\/|basilicata\/|molise\/|valle-d-aosta\/|trentino-alto-adige\/)[^/]+\/[^/]+\//.test(url)
    || /paginegialle\.it\/[^/]+$/.test(url);
}

function extractUrlKey(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function extractName(title, url, town) {
  let t = title || "";

  const prefixes = /^[»ᐅ\s\-–—|▪•·]+/;
  t = t.replace(prefixes, "").trim();

  t = t.replace(/^Pagine Gialle\b/i, "").trim();

  if (t.startsWith("Miglior")) return "";
  if (t.startsWith("Trova il")) return "";
  if (/^\d+ migliori/i.test(t)) return "";
  if (t === "(no title)" || t === "") return extractNameFromUrl(url);

  t = t.replace(/\s*-\s*Pagine[Gg]ialle\b.*$/i, "");

  const townRe = escapeRegExp(town);
  const townPattern = new RegExp(`\\s*[–-]\\s*${townRe}(\\s*\\([A-Z]{2}\\))?(?=\\s*[:]|\\s*$|$)|\\s+a\\s+${townRe}(\\s*\\([A-Z]{2}\\))?.*$`, "i");
  t = t.replace(townPattern, "").trim();

  t = t.replace(/\s*[–-]\s*(ristoranti?\b|pizzerie?\b|trattorie?\b|osterie?\b|bar\b|pasticceria\b|agriturismo\b)\s*.*$/i, "");

  t = t.replace(/\s*[–-]\s*(ristorante|pizzeria|trattoria|osteria)\s+\w+(\s+\([A-Z]{2}\))?\s*$/i, "");

  t = t.replace(/\s*[:]\s*.*$/, "");

  t = t.trim();
  if (!t || t.length < 3) return extractNameFromUrl(url);

  return capitalizeName(t);
}

function capitalizeName(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];

    let name = last
      .replace(/_T?\d+$/, "")
      .replace(/_\d+$/, "")
      .replace(/\.html$/, "");

    name = name.replace(/[-_]+/g, " ");
    name = name.replace(/^(ristorante|pizzeria|trattoria|osteria)[-\s]+/i, "");

    if (name.length < 3) return "";
    return capitalizeName(name);
  } catch {
    return "";
  }
}

function extractType(url, title) {
  const lowerUrl = url.toLowerCase();
  const lowerTitle = (title || "").toLowerCase();

  if (lowerUrl.includes("/pizzerie/") || lowerUrl.includes("/pizzeria")
    || lowerTitle.includes("pizzeria")) return "pizzeria";
  if (lowerUrl.includes("/trattorie/") || lowerUrl.includes("/trattoria")
    || lowerTitle.includes("trattoria")) return "trattoria";
  if (lowerUrl.includes("/osterie/") || lowerUrl.includes("/osteria")
    || lowerTitle.includes("osteria")) return "osteria";
  if (lowerUrl.includes("/sushi/") || lowerTitle.includes("sushi")) return "sushi";
  if (lowerUrl.includes("/cinese") || lowerTitle.includes("cinese")) return "cinese";
  if (lowerUrl.includes("/giapponese") || lowerTitle.includes("giapponese")) return "giapponese";
  if (lowerUrl.includes("/carne") || lowerTitle.includes("carne")) return "carne";
  if (lowerUrl.includes("/pesce") || lowerTitle.includes("di pesce")) return "pesce";

  return "ristorante";
}

function extractAddress(title, town) {
  if (!title) return "";
  const lower = title.toLowerCase();
  const townLower = town.toLowerCase();

  const patterns = [
    new RegExp(`a\\s+${escapeRegExp(town)}\\s+\\(([A-Z]{2})\\)`, "i"),
  ];

  for (const p of patterns) {
    const m = lower.match(p);
    if (m) return `${town} (${m[1].toUpperCase()})`;
  }

  if (lower.includes(townLower)) return town;
  return "";
}