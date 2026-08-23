import { get, getRendered } from "../scripts/lib.mjs";
import { search } from "./lib/search.mjs";

const REVIEW_DOMAINS = [
  "restaurantguru.it", "sluurpy.it",
  "tripadvisor.it", "thefork.it", "thefork.com",
  "facebook.com", "instagram.com",
  "paginegialle.it", "pagina-inizio.com",
];

const MENU_PATH_TERMS = [
  "menu", "menù", "carta", "listino",
  "carne", "pesce", "pizza", "brace",
  "asporto", "domicilio", "cucina",
  "antipasti", "primi", "secondi", "dolci",
  "cantina", "vini", "birre", "bevande",
  "prenota", "ordina", "ordine",
];

export async function findMenuSources(restaurant, location) {
  const { name, website } = restaurant;
  const domain = extractDomain(website);
  const sources = [];

  if (website) {
    const fromSite = await huntOnWebsite(website);
    for (const s of fromSite) sources.push(s);
  }

  const fromSearch = await huntViaSearch(name, location, domain);
  for (const s of fromSearch) sources.push(s);

  const nameTokens = tokenize(name);
  const locTokens = tokenize(location);

  return dedupe(sources)
    .filter((s) => isNotReviewAggregator(s))
    .filter((s) => isRelevantPdf(s, nameTokens, locTokens));
}

async function huntOnWebsite(website) {
  let html;
  try {
    const res = await get(website, { timeout: 20_000 });
    if (!res.ok) return [];
    html = res.body;
  } catch {
    return [];
  }

  const textLen = stripTags(html).length;

  if (textLen < 200 || /enable\s?(js|javascript)/i.test(html)) {
    try {
      const rendered = await getRendered(website, { timeout: 25_000 });
      if (rendered.ok && rendered.body && rendered.body.length > html.length + 100) {
        html = rendered.body;
      }
    } catch {}
  }
  const sources = [];
  const menuTerms = ["menu", "menù", "carta", "listino"];
  const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let m;
  while ((m = linkPattern.exec(html))) {
    const href = m[1];
    const linkText = stripTags(m[2]).toLowerCase();
    if (menuTerms.some((t) => href.toLowerCase().includes(t) || linkText.includes(t))) {
      const resolved = resolveUrl(href, website);
      if (!sources.some((s) => s.url === resolved)) {
        sources.push({
          type: /\.pdf(\?|$)/i.test(resolved) ? "pdf" : "webpage",
          url: resolved,
          found_via: "website_links",
        });
      }
    }
  }

  if (sources.length === 0 && textLen < 1500) {
    const navLinks = extractNavLinks(html, website);
    for (const link of navLinks) {
      if (!sources.some((s) => s.url === link)) {
        sources.push({
          type: "webpage",
          url: link,
          found_via: "website_nav_links",
        });
      }
    }

    if (sources.length === 0) {
      const sitemapSources = await trySitemaps(website);
      for (const s of sitemapSources) sources.push(s);
    }
  }

  return sources;
}

function extractNavLinks(html, base) {
  const links = [];
  const domain = extractDomain(base);
  const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>(?:([\s\S]*?))<\/a>/gi;
  const seen = new Set();

  let m;
  while ((m = linkPattern.exec(html))) {
    const href = m[1];
    const text = stripTags(m[2]).toLowerCase();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;

    const resolved = resolveUrl(href, base);
    const destDomain = extractDomain(resolved);
    if (destDomain !== domain && destDomain !== "") continue;

    const isMenuish = MENU_PATH_TERMS.some((t) =>
      resolved.toLowerCase().includes(t) || text.includes(t)
    );
    const isNavLink = !isMenuish && resolved.split("/").length > 3 && resolved !== base;

    if (isMenuish && !seen.has(resolved)) {
      seen.add(resolved);
      links.push(resolved);
    } else if (isNavLink && !seen.has(resolved) && links.length < 8) {
      seen.add(resolved);
      links.push(resolved);
    }
  }

  return links;
}

async function huntViaSearch(name, location, restaurantDomain) {
  const shortName = name.replace(/^(ristorante|pizzeria|trattoria|bar|osteria|hotel)\s+/i, "").trim();
  const queries = [
    `${shortName} ${location} menu`,
    `${shortName} ${location} menù`,
  ];

  const seen = new Set();
  const sources = [];

  for (const q of queries) {
    const results = await search(q, 8);
    if (results.length === 0) continue;

    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);

      const resultDomain = extractDomain(r.url);
      const isPdf = /\.pdf(\?|$)/i.test(r.url);
      const hasMenuKeyword = /menu|menù|carta|listino/i.test(r.title + r.snippet);
      const isSameDomain = restaurantDomain && resultDomain === restaurantDomain;
      const pathLooksRelevant = MENU_PATH_TERMS.some((t) =>
        r.url.toLowerCase().includes(t)
      );

      if (isPdf) {
        sources.push({ type: "pdf", url: r.url, found_via: "web_search" });
      } else if (hasMenuKeyword || (isSameDomain && pathLooksRelevant)) {
        sources.push({ type: "webpage", url: r.url, found_via: "web_search" });
      } else if (isSameDomain && !isHomepage(r.url)) {
        sources.push({ type: "webpage", url: r.url, found_via: "web_search_samedomain" });
      }
    }
  }

  return sources;
}

function isHomepage(url) {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

function extractDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function resolveUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isNotReviewAggregator(source) {
  return !REVIEW_DOMAINS.some((d) => source.url.includes(d));
}

function isRelevantPdf(source, nameTokens, locTokens) {
  if (source.type !== "pdf") return true;
  const url = source.url.toLowerCase();
  const hasName = nameTokens.some((t) => url.includes(t));
  const hasLoc = locTokens.some((t) => url.includes(t));
  return hasName || (hasLoc && nameTokens.length === 0);
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-zà-ù0-9\s]/gi, "")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function dedupe(sources) {
  const seen = new Set();
  return sources.filter((s) => {
    const key = s.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function trySitemaps(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");
  const sitemapPaths = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/wp-sitemap.xml",
    "/sitemap_index.xml",
    "/wp-sitemap-posts-page-1.xml",
    "/page-sitemap.xml",
  ];
  const menuTerms = ["menu", "menù", "carta", "listino"];
  const sources = [];

  for (const path of sitemapPaths) {
    const url = base.endsWith(path) ? base : base + path;
    let sitemapBody;
    try {
      const res = await get(url, { timeout: 15_000 });
      if (!res.ok) continue;
      sitemapBody = res.body;
    } catch {
      continue;
    }

    if (sitemapBody.startsWith("<?xml") || sitemapBody.startsWith("<sitemap")
        || sitemapBody.startsWith("<urlset")) {
      const locRe = /<loc>([^<]+)<\/loc>/gi;
      let m;
      while ((m = locRe.exec(sitemapBody))) {
        const loc = m[1].trim();
        if (menuTerms.some((t) => loc.toLowerCase().includes(t))) {
          if (!sources.some((s) => s.url === loc)) {
            sources.push({
              type: /\.pdf(\?|$)/i.test(loc) ? "pdf" : "webpage",
              url: loc,
              found_via: "sitemap",
            });
          }
        }
      }
    }

    if (sources.length === 0 && sitemapBody.startsWith("<?xml")) {
      const childRe = /<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/gi;
      let cm;
      while ((cm = childRe.exec(sitemapBody))) {
        const childUrl = cm[1].trim();
        let childBody;
        try {
          const childRes = await get(childUrl, { timeout: 15_000 });
          if (!childRes.ok) continue;
          childBody = childRes.body;
        } catch {
          continue;
        }
        const locRe2 = /<loc>([^<]+)<\/loc>/gi;
        let m2;
        while ((m2 = locRe2.exec(childBody))) {
          const loc2 = m2[1].trim();
          if (menuTerms.some((t) => loc2.toLowerCase().includes(t))) {
            if (!sources.some((s) => s.url === loc2)) {
              sources.push({
                type: /\.pdf(\?|$)/i.test(loc2) ? "pdf" : "webpage",
                url: loc2,
                found_via: "sitemap",
              });
            }
          }
        }
      }
    }

    if (sources.length > 0) break;
  }

  return sources;
}