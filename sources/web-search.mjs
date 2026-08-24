import { search } from "../lib/search.mjs";
import { get } from "../lib/lib.mjs";

export async function discover(town) {
  const queries = [
    `ristoranti ${town} sito web`,
    `trattoria pizzeria ${town}`,
    `bar pub paninoteca ${town}`,
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
    const isList = isListingPage(r.title, r.snippet, r.url);
    if (isList) continue;

    let metadata = {};
    try {
      const page = await get(r.url, { timeout: 15_000 });
      if (page.ok) metadata = extractPageMetadata(page.body, town);
    } catch {}

    // Structured data from the venue page is stronger identity evidence than a
    // search title such as "Ristorante Pizzeria in centro - Brand".
    const name = metadata.name
      || extractRestaurantName(r.title, r.snippet, r.url);
    if (!name) continue;

    restaurants.push({
      name,
      type: guessType(r.title, `${r.snippet} ${metadata.description || ""}`),
      address: metadata.address || "",
      website: r.url,
      phone: metadata.phone,
      source: "web_search",
      snippet: r.snippet,
    });
  }

  return restaurants;
}

export function extractRestaurantName(title, snippet = "", url = "") {
  const combined = `${title} ${snippet}`.toLowerCase();
  // Search titles often lead with a generic SEO phrase and put the actual
  // brand after a dash: "Ristorante Pizzeria in centro - Al Giardinetto
  // Ristorante Pizzeria tipico".
  const titleSegments = title.split(/\s*[-–|]\s*/).map((segment) => segment.trim());
  for (const segment of titleSegments.slice(1)) {
    const branded = segment.match(/^(.{3,45}?)\s+(?:ristorante|pizzeria|trattoria|osteria|bar|pub)\b/i);
    if (branded && !/^(?:home|homepage|ristorante|pizzeria)$/i.test(branded[1].trim())) {
      return capitalize(branded[1]);
    }
  }
  const patterns = [
    /(?:ristorante|trattoria|pizzeria|osteria|bar|pub|paninoteca|birreria|enoteca)\s+([A-ZÀ-Ü][a-zà-ü']+(?:\s+[A-ZÀ-Üa-zà-ü']+){0,3})\b/i,
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

  // Search engines often title a small business homepage "Home - Brand".
  // Permit a one-word title only when it matches the site's own hostname;
  // this keeps generic one-word result titles from becoming venues.
  const hostBrand = hostnameBrand(url);
  const segments = title.split(/\s*[-–|]\s*/).map((s) => s.trim());
  const branded = segments.find((segment) =>
    normalizeToken(segment) === normalizeToken(hostBrand)
  );
  if (branded && branded.length >= 3 && branded.length < 50) {
    return capitalize(branded);
  }

  return null;
}

export function extractPageMetadata(html, town) {
  const metadata = {};
  let namePriority = 0;

  const description = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
  if (description) metadata.description = decodeEntities(description[1]).trim();

  for (const value of extractJsonLd(html)) {
    visitJson(value, (node) => {
      if (!node || typeof node !== "object") return;
      const type = String(node["@type"] || "").toLowerCase();
      const priority = /restaurant|foodestablishment|cafe|bar|pub/.test(type) ? 3
        : /localbusiness|organization/.test(type) ? 2
          : /website/.test(type) ? 1 : 0;
      const candidateName = priority ? cleanName(node.name) : "";
      if (candidateName && priority > namePriority) {
        metadata.name = candidateName;
        namePriority = priority;
      }
      if (!metadata.phone && node.telephone) metadata.phone = String(node.telephone).trim();
      if (!metadata.address && node.address) {
        metadata.address = formatStructuredAddress(node.address);
      }
    });
  }

  const text = decodeEntities(stripTags(html));
  if (!metadata.address) metadata.address = extractItalianAddress(text, town);
  if (!metadata.phone) {
    const telLink = html.match(/href=["']tel:([^"']+)/i);
    const phone = telLink || text.match(/(?:\+39\s*)?(?:0\d{1,3})[.\s-]*\d{5,8}\b/);
    if (phone) {
      metadata.phone = (telLink ? telLink[1] : phone[0])
        .replace(/\s+/g, " ").trim();
    }
  }
  return metadata;
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
    "virgilio.it/italia/",
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
    "ricerca ristoranti", "paninoteca a ", "paninoteche a ",
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
  if (combined.includes("paninoteca")) return "paninoteca";
  if (combined.includes("birreria")) return "pub";
  if (combined.includes("pub ") || combined.endsWith("pub")) return "pub";
  if (combined.includes("bar ")) return "bar";
  if (combined.includes("enoteca")) return "enoteca";
  if (combined.includes("ristorante")) return "restaurant";
  return "restaurant";
}

function capitalize(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function hostnameBrand(url) {
  try {
    const labels = new URL(url).hostname.replace(/^www\./, "").split(".");
    return labels[0] === "wordpress" ? "" : labels[0];
  } catch {
    return "";
  }
}

function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9à-ù]/g, "");
}

function extractJsonLd(html) {
  const values = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try { values.push(JSON.parse(decodeEntities(match[1]))); } catch {}
  }
  return values;
}

function visitJson(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (child && typeof child === "object") visitJson(child, visitor);
  }
}

function formatStructuredAddress(address) {
  if (typeof address === "string") return address.trim();
  if (!address || typeof address !== "object") return "";
  return [address.streetAddress, address.postalCode, address.addressLocality]
    .filter(Boolean).join(", ").trim();
}

function extractItalianAddress(text, town) {
  const street = text.match(/\b(?:via|viale|piazza|piazzale|corso|largo|vicolo|strada|località|borgo|contrada)\s+[a-zà-ù' .-]{1,55}?\s*,?\s*\d+(?:\s*\/\s*[a-z0-9]+)?\b/i);
  if (!street) return "";
  const value = street[0]
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\/\s*/g, "/")
    .trim();
  return town && !value.toLowerCase().includes(town.toLowerCase())
    ? `${value}, ${town}`
    : value;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (name.length < 3 || name.length >= 50) return "";
  if (/^(ristorante|pizzeria|trattoria|osteria|bar|home|homepage)$/i.test(name)) return "";
  return capitalize(name);
}
