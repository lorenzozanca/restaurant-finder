#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { registrableDomain } from "../lib/publisher-ownership.mjs";

const REVIEWED_AT = "2026-09-07T15:30:00.000Z";
const VERIFIED = new Map([
  [9,["anticacasarava.com"]],[18,["eatbu.com"]],[30,["wordpress.com"]],
  [36,["pierrealexis.it"]],[42,["breithornhotel.com"]],[48,["mcdonalds.it"]],
  [52,["mcdonalds.it"]],[55,["anonimodifferentpub.it"]],[57,["gelateria-oasi.it"]],
  [59,["fragoletta.it"]],[62,["lapiadineria.com"]],[65,["gelaterialariana.it"]],
  [72,["lapiadineria.com"]],[101,["pizzeriaristorantedamiceon.com"]],
  [113,["kebabsanfior.it"]],[134,["pizzeriavicinomare-trieste.com","pizzeria-mancini-vicino-o-mare.it"]],
  [140,["osteriadaartico.it"]],[157,["pasqualiniilcaffe.it"]],[167,["novepunto80.com"]],
  [169,["eatbu.com"]],[173,["cafedevue.com"]],[188,["armenocaffe.it"]],
  [205,["eatbu.com"]],[210,["arciprato.it"]],[211,["diba70.it"]],
  [244,["caffeeuropa.eu"]],[246,["caffedivinoshop.it"]],
  [253,["lucampano.it","pizzeriaristorantelucampano.it"]],[259,["eatbu.com"]],
  [265,["johnnyspiedino.it"]],[283,["saporetti.it"]],[287,["burgerking.it"]],
  [288,["caffemilord.it"]],[297,["eatbu.com"]],[303,["caffesanmarco.it"]],
  [305,["wixsite.com"]],[325,["alfaraonepizzeria.com","eatbu.com"]],
  [333,["lidoauroracampomarino.it"]],[346,["mcdonalds.it"]],
  [361,["eburumcaffe.it"]],[373,["salottobohemiencapri.it"]],
  [405,["sfizio.shop"]],[410,["85015ristopub.it"]],[411,["osteriavecchiocortile.it"]],
  [432,["ilmonaco.it"]],[442,["lostuzzichinosoverato.it"]],
  [443,["don-vitto-pizza-e-sfizi.it"]],[444,["gelatidominique.com"]],
  [455,["scornavacche.com"]],[481,["eatbu.com"]],[490,["ilparcodeipini.com"]],
  [495,["gelateriaartigianaleoristano.it"]],
]);
const UNCERTAIN = new Map([
  [128,["bazzara.it"]],[192,["letradizionidinick.it"]],
  [198,["mokadorcasaecaffe.it"]],[215,["berkthepub.com"]],
  [326,["gustusristorante.com"]],[328,["caffecamardo.com"]],
  [330,["dickenspub.it"]],[353,["madaibakerycafe.it","madaisrl.it","eatbu.com"]],
  [421,["mcdonalds.it"]],[430,["pizzeria270grammi.it"]],
  [462,["pizzeriaanimaecori.it"]],
]);

const SOCIAL = /^(?:facebook|instagram|linkedin|tiktok|x|youtube)\.com$/;
const MENU = /(?:carta\.menu|faimenu\.it|leggimenu\.it|menudigitale\.io|menustic\.com|menuweb\.menu|mymenuweb\.com|piatti\.menu|qodeup\.com)$/;
const BOOKING = /(?:airbnb|autoreserve|booking|deliveroo|glovoapp|justeat|thefork|toogoodtogo|vrbo)\./;
const EDITORIAL = /(?:abruzzoweb|acsmagazine|altraopinione|capriarchitettura|cheventi|davinotti|falstaff|gamberorosso|giornaletrentino|ilgiunco|ilmonferrato|ilsarrabus|iltaccodibacco|iltirreno|laprimalinea|lefigaro|lucianopignataro|nuovaopinione|romagnaatavola|saleepepequantobasta|sassilive|tripadvisor|wanderlog|wikipedia)/;
const DIRECTORY = /(?:agriturismi|alltrails|apetime|apple|aragosta|at\.it|atoka|atly|aziende|bbplanet|beniculturalionline|bestogoo|brekko|cai\.it|capri\.com|castelrotto|celiachiaitalia|coobiz|coffeeland|companyreports|coparking|corestaurant|cylex|cybo|destinia|distanzechilometriche|dovepasticcio|eatoutsicily|estateinsardegna|expydoc|findglocal|findski|firmania|foodiestrip|foodlista|foodyas|gastroranking|gelatomaps|glutoapp|happycow|hey-restaurants|hikersbay|hotels|icribis|identitagolose|impresaitalia|indabox|italia\.it|italy724|kayak|lamigliorepizzeria|life-greenwoolf|localitybiz|localshop24|lovevda|mammamiabistrot|mapcarta|mapstr|maptap|michelin|minube|misterimprese|moovitapp|myandroid|mycoffee|mycia|near-place|nextdoor|nutrixe|openalfa|oraridiapertura|overplace|paginebianche|paginegialle|paginesi|papido|parks\.it|placejoys|piemonteitalia|pos\.do|praline-project|prontoimprese|prontopro|pulled\.coffee|ragusawelcome|registroaziende|reportazienda|restaurants-de-france|reteimprese|ristorantevicari|rovigoinfocitta|scribd|shazam|sky\.it|sluurpy|spiagge|swipein|todobares|top-rated|touringclub|trevisoperte|trip\.com|triptap|trova-aperto|trovaziende|trustpilot|tuttiaffari|tuttocitta|unionpedia|untappd|virgilio|visura|waze|wecake|wheree|wogha|worldplaces|xrayfinance|yyahu|zabihah)/;

function rejectedClass(domain) {
  if (SOCIAL.test(domain)) return "social";
  if (MENU.test(domain)) return "menu_mirror";
  if (BOOKING.test(domain)) return "booking_or_order_platform";
  if (EDITORIAL.test(domain)) return "editorial_or_review";
  if (DIRECTORY.test(domain)) return "directory";
  return "unrelated";
}

const directory = resolve("benchmark/session-12-extension-web");
const fixtures = readdirSync(directory).filter((name) =>
  /^locked-holdout-capture-\d{3}-\d{3}\.partial\.json$/.test(name)).sort()
  .flatMap((name) => JSON.parse(readFileSync(resolve(directory, name), "utf8")).entries);

function review(entry, sampleIndex) {
  const byDomain = new Map();
  for (const candidate of entry.candidates) {
    const domain = registrableDomain(candidate.url);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(candidate.url);
  }
  const verified = new Set(VERIFIED.get(sampleIndex) || []);
  const uncertain = new Set(UNCERTAIN.get(sampleIndex) || []);
  for (const domain of [...verified, ...uncertain]) {
    if (!byDomain.has(domain)) throw new Error(`review target absent at sample ${sampleIndex}: ${domain}`);
  }
  const domainReviews = [...byDomain].map(([domain, evidenceUrls]) => {
    if (verified.has(domain)) return {
      registrable_domain: domain, publisher_class: "official", ownership_status: "verified",
      evidence_urls: evidenceUrls, ownership_method: "manual_first_party_review",
      ownership_reviewed_at: REVIEWED_AT, ownership_evidence_urls: [evidenceUrls[0]],
    };
    if (uncertain.has(domain)) return {
      registrable_domain: domain, publisher_class: "uncertain", ownership_status: "uncertain",
      evidence_urls: evidenceUrls,
      uncertainty_reason: sampleIndex === 353
        ? "Retained first-party candidates identify Madai Bakery Café in Avellino, but direct inspection did not identify the selected Contrada Amoretta branch; exact branch ownership remains unresolved."
        : "The retained custom-domain result plausibly identifies the venue, but two direct inspections could not establish publisher control because of a cache, timeout, access, anti-bot, safety, or content-size failure.",
      uncertainty_reviewed_at: REVIEWED_AT, uncertainty_evidence_urls: evidenceUrls,
    };
    return { registrable_domain: domain, publisher_class: rejectedClass(domain),
      ownership_status: "rejected", evidence_urls: evidenceUrls };
  });
  const acceptedDomain = [...byDomain.keys()].find((domain) => verified.has(domain));
  const acceptedUrl = acceptedDomain ? byDomain.get(acceptedDomain)[0] : null;
  return {
    venue_id: entry.venue_id,
    official_website_status: acceptedUrl ? "accepted" : uncertain.size ? "uncertain" : "no_official_site",
    official_website_url: acceptedUrl,
    evidence_urls: entry.candidates.map((candidate) => candidate.url),
    domain_reviews: domainReviews,
  };
}

const allStarts = [1, 101, 201, 301, 401];
const requestedStart = process.argv[2] === undefined ? null : Number(process.argv[2]);
if (requestedStart !== null && !allStarts.includes(requestedStart)) {
  throw new Error(`Unknown range start ${process.argv[2]}; expected one of ${allStarts.join(", ")}`);
}
const documents = [];
for (const start of requestedStart === null ? allStarts : [requestedStart]) {
  const end = start + 99;
  documents.push({
    schema_version: 1,
    adjudication_set: `session-12-powered-locked-holdout-extension-adjudication-${String(start).padStart(3,"0")}-${String(end).padStart(3,"0")}`,
    partition: "locked_holdout", source: "independent_fixture_review",
    selection_fingerprint_sha256: "ad9d58f215a91ce0da8863e03bbe33cc6442a664bcd0d7c6022e83efa3b06e8e",
    reviewer: "Codex independent bounded-fixture review",
    reviewed_at: REVIEWED_AT,
    review_basis: "Independent review of retained bounded-query URL/title metadata and direct inspection of every plausible retained first-party URL; publisher ownership is verified only when retained first-party content identifies the selected venue or exact chain branch.",
    scope_limitations: "No search query was issued or reopened during adjudication. Failed direct inspections received at most one identical-URL retry and remain uncertain when publisher control or exact branch identity could not be established.",
    entries: fixtures.slice(start - 1, end).map((entry, offset) => review(entry, start + offset)),
  });
}
process.stdout.write(JSON.stringify(requestedStart === null ? documents : documents[0], null, 2));
