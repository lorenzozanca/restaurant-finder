#!/usr/bin/env node
// Key-less web search across several engines.
//
// Engine reality as measured 2026-08-20 from this machine:
//   working  — Brave (best), Bing (redirect URLs are base64), Marginalia (small index)
//   blocked  — DuckDuckGo (202 anomaly page), Ecosia (403), Mojeek (captcha),
//              every public SearXNG instance tried (403/429/browser check)
// Engines are tried in order and the first one that returns results wins. If an engine
// starts failing, it says so rather than returning silently empty.

import { get, fragmentText, decodeEntities } from "./html.mjs";

// This machine's IP does not geolocate to Italy, so every engine is pinned to an
// Italian market explicitly. Without that, Bing returns results for wherever the
// exit node happens to be.
const ENGINES = {
  brave: {
    url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&country=it`,
    parse: parseBrave,
  },
  bing: {
    url: (q) =>
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=it-IT&cc=IT&setlang=it`,
    parse: parseBing,
  },
  marginalia: {
    url: (q) => `https://search.marginalia.nu/search?query=${encodeURIComponent(q)}`,
    parse: parseMarginalia,
  },
};

function parseBrave(html) {
  const out = [];
  for (const block of html.split('<div class="snippet ').slice(1)) {
    const head = block.slice(0, 6000);
    const href = head.match(/href="(https?:\/\/[^"]+)"/);
    if (!href || /search\.brave\.com|imgs\.search\.brave/.test(href[1])) continue;
    const title = head.match(/class="[^"]*search-snippet-title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const desc = head.match(/class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    out.push({
      url: href[1],
      title: title ? fragmentText(title[1]) : "",
      snippet: desc ? fragmentText(desc[1]) : "",
    });
  }
  return out;
}

function parseBing(html) {
  const out = [];
  for (const block of html.split('class="b_algo"').slice(1)) {
    const head = block.slice(0, 6000);
    // The result link is the anchor inside the block's <h2>. The first href in the
    // block is often a stylesheet or a thumbnail.
    const href = head.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/);
    if (!href) continue;
    const url = resolveBingUrl(decodeEntities(href[1]));
    if (!url || !/^https?:\/\//.test(url) || /bing\.com|microsoft\.com/.test(url)) continue;
    const title = head.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const desc = head.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({
      url,
      title: title ? fragmentText(title[1]) : "",
      snippet: desc ? fragmentText(desc[1]) : "",
    });
  }
  return out;
}

// Bing wraps results in /ck/a?...&u=a1<base64url of the real URL>.
function resolveBingUrl(href) {
  const m = href.match(/u=a1([A-Za-z0-9_-]+)/);
  if (!m) return href;
  try {
    return Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return href;
  }
}

function parseMarginalia(html) {
  const out = [];
  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    if (/marginalia|w3\.org|creativecommons|github\.com\/MarginaliaSearch|ip2location/.test(m[1])) continue;
    const title = fragmentText(m[2]);
    if (!title || title.length < 3) continue;
    if (out.some((r) => r.url === m[1])) continue;
    out.push({ url: m[1], title, snippet: "" });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 10;
  let only = null;
  const terms = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-n") limit = parseInt(args[++i], 10) || 10;
    else if (args[i] === "-e") only = args[++i];
    else terms.push(args[i]);
  }
  const query = terms.join(" ").trim();
  if (!query) {
    console.error('usage: search.sh [-n 10] [-e brave|bing|marginalia] "your query"');
    process.exit(2);
  }

  const order = only ? [only] : Object.keys(ENGINES);
  const notes = [];

  for (const name of order) {
    const engine = ENGINES[name];
    if (!engine) {
      console.error(`unknown engine: ${name}`);
      process.exit(2);
    }
    // Brave rate-limits bursts. Retry once after a short pause, then fall through:
    // callers can issue dozens of searches and long per-query backoffs multiply into
    // several minutes without improving a sustained 429 response.
    let res = await get(engine.url(query));
    for (const wait of [2000]) {
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, wait));
      res = await get(engine.url(query));
    }
    if (!res.ok) {
      notes.push(`${name}: HTTP ${res.status}${res.error ? ` (${res.error})` : ""}`);
      continue;
    }
    const results = engine.parse(res.body).slice(0, limit);
    if (results.length === 0) {
      notes.push(`${name}: 0 results parsed (blocked, or the page layout changed)`);
      continue;
    }
    // Warnings go first. A cycle that pipes this through `head` must still see them.
    if (notes.length) console.log(`# engines skipped: ${notes.join("; ")}`);
    if (name === "bing") {
      console.log("# ⚠ FALLBACK ENGINE — Bing. For niche or brand-name queries it returns");
      console.log("# confidently irrelevant results rather than nothing. If these look");
      console.log("# unrelated to what you asked for, they ARE. Discard them and rephrase.");
    }
    console.log(`# ${results.length} results for "${query}" via ${name}\n`);
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.title || "(no title)"}`);
      console.log(`   ${r.url}`);
      if (r.snippet) console.log(`   ${r.snippet.slice(0, 300)}`);
      console.log("");
    });
    return;
  }

  console.log(`# no results for "${query}"`);
  console.log(`# ${notes.join("\n# ")}`);
  console.log("# All engines failed. Try a different phrasing, or go to a known site directly.");
  process.exit(1);
}

main();
