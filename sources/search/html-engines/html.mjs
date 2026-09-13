// The subset of researcher/scripts/lib.mjs that search.mjs needs, copied here so this
// repo no longer reaches into a sibling checkout. Node built-ins only.

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function get(url, { timeout = 25000, headers = {} } = {}) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: control.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
        ...headers,
      },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, body };
  } catch (err) {
    return { ok: false, status: 0, url, body: "", error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€",
  pound: "£", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", agrave: "à", egrave: "è", eacute: "é", igrave: "ì",
  ograve: "ò", ugrave: "ù", middot: "·", bull: "•", deg: "°", trade: "™",
  copy: "©", reg: "®", laquo: "«", raquo: "»",
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Text content of an HTML fragment, on one line. */
export function fragmentText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
