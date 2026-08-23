import { get } from "../../scripts/lib.mjs";
import { search } from "../lib/search.mjs";

export async function discover(town) {
  const direct = await tryDirectTheFork(town);
  if (typeof direct === "string") {
    console.error(`[thefork] ${direct} — blocked or captcha`);
    return [];
  }
  if (direct.length > 0) return direct;

  let results = await search(`site:thefork.it ristorante ${town}`, 10);
  if (results.length === 0) {
    results = await search(`thefork.it ristorante ${town}`, 10);
    if (results.length === 0) return [];
  }

  const restaurants = [];
  for (const r of results) {
    const match = r.url.match(/thefork\.(it|com)\/ristorante\/([^/?]+)(?!-r\d)/);
    if (!match) continue;

    const slug = match[2];
    const name = slug
      .split(/[-\/]/)
      .filter((w) => w.length > 1 && !/^(r\d+|[a-z]{2})$/.test(w))
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    if (name.length > 3 && name.length < 50) {
      restaurants.push({
        name,
        type: "restaurant",
        address: "",
        website: r.url,
        source: "thefork",
      });
    }
  }

  return restaurants;
}

async function tryDirectTheFork(town) {
  const encoded = encodeURIComponent(town);
  const url = `https://www.thefork.it/search/restaurants/${encoded}?cc=it`;
  try {
    const res = await get(url, { timeout: 20_000 });
    if (!res.ok) return [];
    const html = res.body;

    const results = [];
    const cardRe = /<script type="application\/ld\+json">([^<]+)<\/script>/g;
    let m;
    while ((m = cardRe.exec(html))) {
      try {
        const data = JSON.parse(m[1]);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item["@type"] === "Restaurant" && item.name) {
              results.push({
                name: item.name,
                type: "restaurant",
                address: item.address?.streetAddress || "",
                website: item.url || undefined,
                phone: item.telephone || undefined,
                source: "thefork",
              });
            }
          }
        }
      } catch {}
    }

    if (results.length > 0) return results;

    const linkRe = /href="\/ristorante\/([^/"]+)-r(\d+)/g;
    const seen = new Set();
    while ((m = linkRe.exec(html))) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const name = slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      results.push({
        name,
        type: "restaurant",
        address: "",
        website: `https://www.thefork.it/ristorante/${slug}-r${m[2]}`,
        source: "thefork",
      });
    }
    return results;
  } catch {
    return [];
  }
}