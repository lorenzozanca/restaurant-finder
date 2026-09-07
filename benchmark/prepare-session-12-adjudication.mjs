#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { registrableDomain } from "../lib/publisher-ownership.mjs";

const DIRECTORY_DOMAINS = new Set([
  "accademia1953.it", "apetime.com", "appgelato.it", "apple.com", "atoka.io",
  "autoreserve.com", "bagnidilucca.info",
  "camperistorante.it", "cartogiraffe.com", "celiachiaitalia.com", "cercastrade.com",
  "cittadiverona.it", "cogole.to", "coparking.ch", "corestaurant.ch", "cybo.com",
  "cylex-italia.it", "diwinetaste.com", "dovepasticcio.it", "firmania.it",
  "distanzechilometriche.net", "espressodolcevita.it", "flowinacquasparta.com",
  "foodiestrip.com", "foodle.pro", "foodyas.com", "forlimpopolicittartusiana.it",
  "frhome.it", "gelatomaps.com", "glutoapp.com", "google.com", "google.it",
  "guidasicilia.it", "hotelcentro.net",
  "hey-restaurants.com", "icribis.com", "impegnatipersirolo.it", "impresaitalia.info",
  "iltaccodibacco.it", "imposta-soggiorno.org", "indabox.it", "informazione-aziende.it",
  "italia.it", "kioku.it", "li.it", "localitybiz.com", "localitybiz.it",
  "lagodigarda.com", "lathuile.it", "localshop24.com", "lovevda.it", "mapstr.com",
  "majellando.it", "materawelcome.it", "minube.it", "momondo.ie", "monopolix.it",
  "montecosarodascoprire.it", "myadj.it", "near-place.com", "openalfa.com", "openalfa.it",
  "oraridiapertura24.it", "pagineurbane.it", "parks.it", "portamici.it", "pulled.coffee",
  "qrtour.it", "reportazienda.it", "restaurantguru.com", "restaurantguru.it", "reteimprese.it",
  "overplace.com", "paginegialle.it", "prolococartoceto.com", "registroaziende.it",
  "ricercare-imprese.it", "sardiniahotel24.com", "scopripalestrina.it", "spotmap.it",
  "top-hotels-sardinia.com", "tophotels.com", "trova-aperto.it", "trovacigusto.com",
  "tuttocitta.it", "tuttosuitalia.com",
  "turismovallecamonica.it", "ufficiocamerale.it", "virgilio.it",
  "tuttiaffari.com", "viamichelin.com", "visitmolise.eu", "visitvaldicecina.com",
  "visitsilvi.it", "viveresuvereto.it", "vota.org", "waze.com",
  "xrayfinance.it",
]);
const OFFICIAL_DOMAINS_WITH_REJECTED_VENUE_EVIDENCE = new Set(["lapiadineria.fr"]);
const MENU_MIRROR_DOMAINS = new Set([
  "carta.menu", "jmenu.it", "menuweb.menu", "menustic.com", "mymenuweb.com", "piatti.menu",
]);
const BOOKING_OR_ORDER_DOMAINS = new Set([
  "airbnb.com", "airbnb.fr", "booking.com", "eatbu.com", "justeat.it", "matrimonio.com",
  "metro.bar", "ordina-online-ristoranti.it", "spiagge.it", "take2me.it", "thefork.com",
  "thefork.it",
]);
const EDITORIAL_OR_REVIEW_DOMAINS = new Set([
  "altraopinione.org", "battipaglianews.it", "borgoracconta.it", "casertamusica.com",
  "cosenzaduepuntozero.it", "falstaff.com", "gamberorosso.it", "grumonevanonews.com",
  "ilfaro24.it", "mixerplanet.com",
  "nuovaopinione.it", "sluurpy.it", "tripadvisor.ca", "tripadvisor.co.uk",
  "tripadvisor.com", "tripadvisor.com.au", "tripadvisor.com.br", "tripadvisor.com.tr",
  "tripadvisor.de", "tripadvisor.es", "tripadvisor.in", "tripadvisor.it", "tripadvisor.pt",
  "tripadvisor.at", "tripadvisor.ch", "saleepepequantobasta.com", "sardegnatoujours.com",
  "sassilive.it", "siciliaunonews.com", "termolionline.it", "touringclub.it",
  "umbriajournaltv.it", "wanderlog.com", "wikivoyage.org", "wordpress.com",
]);
const SOCIAL_DOMAINS = new Set(["linkedin.com"]);
const UNRELATED_DOMAINS = new Set([
  "accredia.it", "amazonaws.com", "ao.it", "artecora.it", "cairoma.it", "casapautasso.it",
  "cloudfree.jp", "consorzioasibari.it", "davinotti.com", "dolomiti.org", "donboscoland.it",
  "escursionismo.it", "eseitalia.it", "eurochocolate.com", "expydoc.com", "federciclismo.it",
  "follettidelmorrone.it", "fromthesourcedoc.com", "gov.it", "gruppodeidodici.eu",
  "halleyweb.com", "happylibnet.com", "ice.it", "kleisma.com", "latina.it", "lombardia.it",
  "marche.it",
  "norimarandricardo.it", "onaf.it", "palazzocircolone.it", "paperzz.com",
  "paschixeddamarrubiesa.it", "pg.it", "poste.it", "registro-italiano-vw.it",
  "rifugiovincenzosebastiani.it", "ristoranteyukimarconi.it", "scribd.com", "sisal.com",
  "stradavinotrentino.info", "su.it", "tortolicalcio.it", "toyscenter.it", "unich.it",
  "vigorsol.it", "vr.it",
]);

const REVIEWED_AT = "2026-09-07T07:26:29.000Z";
const VERIFIED = new Map(Object.entries({
  "venue:003149:trecate:mcdonald-s": "https://www.mcdonalds.it/ristorante/piemonte/novara/trecate",
  "venue:004130:mondovi:acquadolce-agritrutta-parco-eventi-acquadolce-mondovi": "https://www.acquadolce.net/",
  "venue:007003:aosta:french-tacos": "https://www.frenchtacos-aosta.it/",
  "venue:007021:cogne:brasserie-du-bon-bec": "https://www.hotelbellevue.it/fr/ristoranti/la-brasserie-du-bon-bec",
  "venue:015146:milano:incas": "https://www.caffeincas.it/",
  "venue:108033:monza:victory54": "https://www.victory54.it/ristorante/",
  "venue:015249:vanzaghello:piadineria": "https://lapiadineria.com/regolamento-concorso",
  "venue:021008:bolzano-bozen:imbiss-kampill": "https://www.imbiss-kampill.com/",
  "venue:024028:castelgomberto:albergo-isetta": "https://www.trattoriaisetta.com/contattaci",
  "venue:024116:vicenza:magazzino-del-caffe": "https://www.mdc-group.it/magazzino-del-caffe-vicenza/",
  "venue:024042:gallio:capr-allegra": "https://www.lacaprallegra.it/",
  "venue:030117:tarvisio:convento-da-jure": "https://rifugioalconvento.it/wp-content/uploads/2018/08/brochure.pdf",
  "venue:093031:polcenigo:taverna-slow-shop-bar": "https://www.latavernaslowshopandbar.com/",
  "venue:009068:villanova-d-albenga:boschetto": "https://www.ilboschettomatrimoni.it/",
  "venue:010044:portofino:da-o-batti": "https://www.daobattiportofino.it/",
  "venue:011015:la-spezia:murphy-s-la-spezia": "https://www.murphysp.it/contatti",
  "venue:011003:beverino:pro-loco-beverino-in-val-di-vara": "https://www.prolocobeverinovaldivara.org/",
  "venue:035044:viano:vulcanetto-del-querciola": "https://www.ilvulcanetto.it/",
  "venue:036015:formigine:mcdonald-s": "https://www.mcdonalds.it/static/app/ristoranti-aderenti.html",
  "venue:099014:rimini:portolotto": "https://www.ilportolotto.it/ita-contatti",
  "venue:037006:bologna:rosticceria-da-toto": "https://pizzeria-rosticceria-da-toto.it/",
  "venue:053028:semproniano:novecento": "https://www.ristorantenovecentosemproniano.com/",
  "venue:048017:firenze:berbere-pizzeria": "https://www.berberepizza.it/en/berbere-firenze-san-frediano/",
  "venue:050015:guardistallo:giunche": "https://locandalegiunche.it/",
  "venue:041013:fano:dalla-peppa": "https://www.osteriadallapeppa.it/contatti/",
  "venue:041020:gradara:gustare-alimentari-gourmet": "https://www.gustaregourmet.com/",
  "venue:043041:pollenza:brian-boru-pub": "https://www.brianboru.it/contatti/",
  "venue:058091:roma:gima-caffe": "https://www.gimacaffe.it/condizione-vendita/",
  "venue:058091:roma:piadineria-88ccf508": "https://www.lapiadineria.com/public/up/2025COCA-COLA-CONCORSOOLIMPIADI-LA%20PIADINERIA_instant_win_SMSWhatsApp%20DEF.pdf",
  "venue:060025:ceprano:ciolli-caffe": "https://ciollicaffe.it/",
  "venue:058022:castel-gandolfo:birrodrome-ristorante-pizzeria": "https://birrodrome.com/en/chi-siamo/",
  "venue:063049:napoli:taralleria-napoletana": "https://tarallerianapoletana.com/pages/store",
  "venue:061013:capodrise:mcdonald-s": "https://www.mcdonalds.it/static/app/ristoranti-aderenti.html",
  "venue:077014:matera:tipicamente-matera": "https://www.tipica-mente.it/",
  "venue:078103:rocca-imperiale:casetta": "https://www.lacasettapizzeria.it/",
  "venue:078045:cosenza:girone-dei-golosi": "https://www.algironedeigolosi.it/",
  "venue:080039:gioiosa-ionica:benvenuti-al-sud": "https://ristorantebenvenutialsud.it/",
  "venue:083057:montalbano-elicona:villa-sulla": "https://www.pizzeriavillasulla.it/contatti",
  "venue:118008:castiadas:lido-tamatete": "https://www.lidotamatete.it/contatti-e-prenotazioni-lido-tamatete-cala-sinzias/",
  "venue:113017:olbia:peterland-olbia": "https://www.peterlandolbia.it/",
  "venue:112050:sassari:lido-sardegna": "https://www.lidosardegna.it/contatti",
}));
const EXTRA_VERIFIED = new Map(Object.entries({
  "venue:113017:olbia:peterland-olbia": ["https://www.peterland.it/olbia.html"],
}));
const UNCERTAIN = new Map(Object.entries({
  "venue:007033:gressoney-saint-jean:oro-argento-e-bronzo": {
    publisherClass: "uncertain",
    reason: "The retained title identifies the venue and locality, but direct inspection of the retained URL failed twice with a cache miss; bounded evidence does not independently establish publisher control.",
  },
  "venue:019035:crema:mcdonald-s": {
    publisherClass: "official",
    reason: "The retained mcdonalds.it PDF is an official-chain document, but its generic title and inspectable text do not identify the selected Crema branch or either queried address.",
  },
  "venue:030057:martignacco:solo-artisane": {
    publisherClass: "uncertain",
    reason: "The retained title and custom domain identify Solo Artisane, but direct inspection of the retained URL timed out twice and the bounded metadata does not identify the selected Martignacco location.",
  },
  "venue:093037:sacile:german-pub": {
    publisherClass: "uncertain",
    reason: "The retained title and custom domain identify German Pub in Sacile, but direct inspection of the retained URL failed twice with a cache miss; publisher control could not be independently established.",
  },
  "venue:052028:san-gimignano:ceppo-toscano": {
    publisherClass: "uncertain",
    reason: "The retained title and custom domain identify Il Ceppo Toscano in San Gimignano, but direct inspection of the retained URL timed out twice; publisher control could not be independently established.",
  },
  "venue:054002:bastia-umbra:gargotta-villaggio-del-gusto": {
    publisherClass: "uncertain",
    url: "https://www.gargottavillaggiodelgusto.it/",
    reason: "The retained title and custom domain identify Gargotta Villaggio del Gusto in Bastia Umbra, but two direct inspections reached only an anti-bot verification page; venue control could not be independently established.",
  },
  "venue:054039:perugia:spuntino-del-ghiottone": {
    publisherClass: "uncertain",
    url: "https://www.lospuntinodelghiottone.net/contact",
    reason: "The retained title and custom domain identify Lo Spuntino del Ghiottone, but direct inspection of the retained contact URL was unavailable and bounded metadata alone does not establish publisher control.",
  },
  "venue:060038:frosinone:pizzapi": {
    publisherClass: "uncertain",
    url: "https://www.pizzapimenu.com/",
    reason: "The retained title and custom domain identify Pizzapì in Frosinone, but direct inspection of the retained URL failed twice; publisher control could not be independently established.",
  },
}));

function publisherClass(domain) {
  if (DIRECTORY_DOMAINS.has(domain)) return "directory";
  if (OFFICIAL_DOMAINS_WITH_REJECTED_VENUE_EVIDENCE.has(domain)) return "official";
  if (MENU_MIRROR_DOMAINS.has(domain)) return "menu_mirror";
  if (BOOKING_OR_ORDER_DOMAINS.has(domain)) return "booking_or_order_platform";
  if (EDITORIAL_OR_REVIEW_DOMAINS.has(domain)) return "editorial_or_review";
  if (SOCIAL_DOMAINS.has(domain)) return "social";
  if (UNRELATED_DOMAINS.has(domain)) return "unrelated";
  throw new Error(`unreviewed publisher domain: ${domain}`);
}

function reviewEntry(entry) {
  const candidateUrls = entry.candidates.map((candidate) => candidate.url);
  const byDomain = new Map();
  for (const url of candidateUrls) {
    const domain = registrableDomain(url);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(url);
  }
  const verifiedUrl = VERIFIED.get(entry.venue_id);
  const verifiedUrls = verifiedUrl ? [verifiedUrl, ...(EXTRA_VERIFIED.get(entry.venue_id) || [])] : [];
  const uncertain = UNCERTAIN.get(entry.venue_id);
  if (verifiedUrl && !candidateUrls.includes(verifiedUrl)) {
    throw new Error(`verified URL is outside fixture for ${entry.venue_id}`);
  }
  const uncertainUrl = uncertain?.url || (byDomain.size === 1 ? candidateUrls[0] : null);
  if (uncertain && (!uncertainUrl || !candidateUrls.includes(uncertainUrl))) {
    throw new Error(`uncertain review lacks an in-fixture target URL for ${entry.venue_id}`);
  }
  const domainReviews = [...byDomain].map(([domain, evidenceUrls]) => {
    const domainVerifiedUrl = verifiedUrls.find((url) => domain === registrableDomain(url));
    if (domainVerifiedUrl) {
      return {
        registrable_domain: domain,
        publisher_class: "official",
        ownership_status: "verified",
        evidence_urls: evidenceUrls,
        ownership_method: "manual_first_party_review",
        ownership_reviewed_at: REVIEWED_AT,
        ownership_evidence_urls: [domainVerifiedUrl],
      };
    }
    if (uncertain && domain === registrableDomain(uncertainUrl)) {
      return {
        registrable_domain: domain,
        publisher_class: uncertain.publisherClass,
        ownership_status: "uncertain",
        evidence_urls: evidenceUrls,
        uncertainty_reason: uncertain.reason,
        uncertainty_reviewed_at: REVIEWED_AT,
        uncertainty_evidence_urls: evidenceUrls,
      };
    }
    return {
      registrable_domain: domain,
      publisher_class: publisherClass(domain),
      ownership_status: "rejected",
      evidence_urls: evidenceUrls,
    };
  });
  return {
    venue_id: entry.venue_id,
    official_website_status: verifiedUrl ? "accepted" : uncertain ? "uncertain" : "no_official_site",
    official_website_url: verifiedUrl || null,
    evidence_urls: candidateUrls,
    domain_reviews: domainReviews,
  };
}

const directory = resolve("benchmark/session-12-web");
const fixtureNames = readdirSync(directory)
  .filter((name) => /^locked-holdout-capture-\d{3}-\d{3}\.partial\.json$/.test(name))
  .sort();
const entries = fixtureNames.flatMap((name) =>
  JSON.parse(readFileSync(resolve(directory, name), "utf8")).entries);
for (const [start, end] of [[21, 120], [121, 220], [221, 320], [321, 420], [421, 500]]) {
  const selected = entries.slice(start - 1, end);
  if (selected.length !== end - start + 1) {
    throw new Error(`expected ${end - start + 1} entries, found ${selected.length}`);
  }
  const document = {
    schema_version: 1,
    adjudication_set: `session-12-powered-locked-holdout-adjudication-${String(start).padStart(3, "0")}-${String(end).padStart(3, "0")}`,
    partition: "locked_holdout",
    source: "independent_fixture_review",
    selection_fingerprint_sha256: "09d36070bdb62e5c64eaa9eada9ca0c240b4deafcfabef091d3ff2eba6645b48",
    reviewer: "Codex independent bounded-fixture review",
    reviewed_at: REVIEWED_AT,
    review_basis: "Independent review of retained bounded-query URL/title metadata and direct inspection of plausible retained candidate URLs; publisher-domain ownership is approved only where retained first-party content identifies the selected venue or exact chain branch.",
    scope_limitations: "No search query was issued or reopened. Minimal URL/title capture and direct inspection of retained candidate URLs only. A no_official_site disposition means no publishable official site was established within the bounded retained evidence, not that no site exists on the open web.",
    entries: selected.map(reviewEntry),
  };
  writeFileSync(resolve(directory,
    `locked-holdout-adjudication-${String(start).padStart(3, "0")}-${String(end).padStart(3, "0")}.json`),
  `${JSON.stringify(document, null, 2)}\n`);
}
