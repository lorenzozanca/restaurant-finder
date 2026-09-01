#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] || "benchmark/SESSION-10-FRESH-PILOT-SELECTION.json");
const reviewedAt = "2026-09-01T12:00:00Z";
const reviewer = "Codex independent web review";
const a = (url, evidence, notes, resources = []) =>
  ["valid", "accepted", url, evidence, notes, resources];
const n = (evidence, notes) => ["valid", "no_official_site", null, evidence, notes, []];
const u = (evidence, notes) => ["uncertain", "uncertain", null, evidence, notes, []];

const rows = new Map([
  [1, a("https://www.mcdonalds.it/", ["https://www.mcdonalds.it/ristorante/piemonte/torino"], "Current first-party locator confirms Torino restaurants; selected branch identity is retained from the pinned source.")],
  [2, n(["https://restaurantguru.it/Cornetti-Coffee-Shop-Turin"], "Current venue evidence supports the cafe; no first-party website was found.")],
  [3, a("https://lagrolla.it/", ["https://www.courmayeurmontblanc.it/en/esperienze/mountain-huts-and-refuges/la-grolla/"], "Current official tourism evidence corroborates La Grolla in Courmayeur and the supplied branded domain.")],
  [4, n(["https://www.courmayeurmontblanc.it/wp-content/uploads/2023/11/aperture-bar_risto_inverno23.pdf"], "Official local material corroborates Lo Brenlo; no first-party site was found.")],
  [5, a("https://www.ristoranteranchroberta.com/", ["https://www.ristoranteranchroberta.com/"], "Current first-party site corroborates the Milano restaurant.")],
  [6, u(["https://www.google.com/search?q=%22Visionary+Cargo+Trailer%2FTruck%22+Milano"], "The source identity is a generic cargo trailer/truck object and current web evidence did not establish an admissible public ice-cream venue.")],
  [7, a("https://www.maurizkeller.com/", ["https://www.maurizkeller.com/it/"], "Current first-party site corroborates the restaurant and pizzeria in Ortisei.")],
  [8, a("https://www.ristorantefour.it/", ["https://www.ristorantefour.it/"], "Current first-party site corroborates Bar Four at Piazza S. Durich 4.")],
  [9, a("https://www.molocortina.com/", ["https://www.molocortina.com/"], "Current first-party site supersedes the supplied legacy Molo Factory URL.")],
  [10, n(["https://cortina.dolomiti.org/wp-content/uploads/2026/01/Cortina_accessibile_guidaufficiale2026.pdf"], "Official Cortina material corroborates Porto Rotondo; no first-party site was found.")],
  [11, a("https://www.caffeguatemala.com/", ["https://www.caffeguatemala.com/"], "Current first-party site corroborates the Trieste coffee business and cafe identity.")],
  [12, n(["https://www.paginegialle.it/trieste-ts/locali-e-ritrovi/mini-pub-2_T10178949", "https://deliveroo.it/it/menu/udine/trieste/mini-pub-2"], "Current listing and ordering evidence corroborate Mini Pub 2; no first-party site was found.")],
  [13, a("https://lagrittaportofino.it/", ["https://lagrittaportofino.it/contact/"], "Current first-party site replaces the supplied TheFork directory URL and corroborates Calata Marconi 20.")],
  [14, n(["https://restaurantguru.com/Calata-32-Portofino"], "Current evidence corroborates Calata 32; no first-party site was found.")],
  [15, a("https://www.mcdonalds.it/", ["https://www.mcdonalds.it/ristorante/emilia-romagna/bologna"], "Current first-party locator confirms Bologna restaurants; selected branch identity is retained from the pinned source.")],
  [16, a("https://radici-pizzeria.it/", ["https://radici-pizzeria.it/"], "Current first-party ordering page corroborates Radici Pizzeria at Via Fondazza 30.")],
  [17, a("https://caffedelleerbesangimignano.it/", ["https://caffedelleerbesangimignano.it/"], "The supplied branded first-party domain is retained; no contradictory current evidence was found.")],
  [18, n(["https://mapcarta.com/N10106633001"], "Current map evidence and business records corroborate La Biscondola; no first-party site was found.")],
  [19, a("https://labastiglia.com/", ["https://labastiglia.com/"], "Current first-party hotel and restaurant site corroborates La Bastiglia in Spello.", [{ url: "https://labastiglia.com/wp-content/uploads/2024/11/Menu_Bastiglia.pdf", role: "menu", status: "accepted" }])],
  [20, u(["https://www.google.com/search?q=%22Il+Giardino+di+Spello%22"], "Current web evidence did not independently establish the exact Il Giardino di Spello identity or operating status.")],
  [21, a("https://www.lovecaffecentrale.it/", ["https://www.lovecaffecentrale.it/", "https://linktr.ee/barcentralesirolo"], "Current first-party site supersedes the supplied Linktree profile and corroborates Sirolo.")],
  [22, n(["https://extrasirolo.it/territorio/dove-mangiare-a-sirolo/"], "Local tourism evidence corroborates L'Oasi Bar; no first-party site was found.")],
  [23, n(["http://lapiazzettamorena.business.site/"], "The supplied Google Business profile is discovery evidence rather than an independent first-party website.")],
  [24, n(["https://www.tuttiaffari.com/new-york-caffe_1f-335-639-2629"], "Current listing evidence corroborates New York Caffè at Largo Somalia; no first-party site was found.")],
  [25, a("https://www.ristorantelafoce.it/", ["https://parcoabruzzo.it/ristoratore.php?id=6557"], "National-park operator listing identifies the restaurant and its official site.")],
  [26, u(["https://www.google.com/search?q=%22Caffe+Santa+Maria%22+Scanno"], "A business name match was found, but current evidence did not reliably corroborate this exact Scanno cafe and address.")],
  [27, a("https://www.pizzeriacampobasso.it/", ["https://www.pizzeriacampobasso.it/menu/", "https://deliveroo.it/it/menu/campobasso/campobasso/pizzeria-pasky-20"], "First-party menu and current ordering evidence corroborate Pasky 2.0 in Campobasso.", [{ url: "https://www.pizzeriacampobasso.it/menu/", role: "menu", status: "accepted" }])],
  [28, n(["https://glovoapp.com/it/it/campobasso/stores/pizzando-cpb"], "Current ordering evidence corroborates Pizzando; no first-party site was found.")],
  [29, a("https://riservarooftop.com/", ["https://riservarooftop.com/contatti/"], "Current first-party site corroborates Riserva Rooftop in Napoli.", [{ url: "https://riservarooftop.com/menu-digitale/", role: "menu", status: "accepted" }])],
  [30, n(["https://glovoapp.com/it/it/napoli/stores/il-gallaccio-takeaway-nap"], "Current ordering evidence corroborates Il Gallaccio TakeAway; no first-party site was found.")],
  [31, a("https://www.mylandalberobello.it/", ["https://www.mylandalberobello.it/"], "Current first-party site corroborates My Land in Alberobello.")],
  [32, n(["https://www.tripadvisor.com.au/Restaurant_Review-g580227-d28038300-Reviews-Cols-Alberobello_Province_of_Bari_Puglia.html"], "Current evidence corroborates Cols cafe at Via Isonzo 35; no first-party site was found.")],
  [33, a("https://www.molinodellacontessa.com/", ["https://www.molinodellacontessa.com/contatti", "https://www.parcogallipolicognato.it/operatore.php?id=22981"], "First-party and park-operator evidence corroborate the venue.")],
  [34, n(["https://www.parcogallipolicognato.it/ristoratore.php?id=11150"], "Regional park evidence corroborates the trattoria in Castelmezzano; no first-party site was found.")],
  [35, a("https://lanticoulivocivita.it/", ["https://lanticoulivocivita.it/ristorante-pizzeria/"], "Current first-party site corroborates L'Antico Ulivo in Civita.", [{ url: "https://lanticoulivocivita.it/menu/", role: "menu", status: "accepted" }])],
  [36, n(["https://s4c098a3697c78ca5.jimcontent.com/download/version/1486486398/module/6847609456/name/LGB%20n.%205_2014.pdf"], "Business evidence corroborates Barri Lart in Civita; no first-party site was found.")],
  [37, a("https://www.anticapasticceriadamichele.com/", ["https://www.anticapasticceriadamichele.com/"], "Current first-party site supersedes the supplied .it URL and corroborates the Erice venue.")],
  [38, u(["https://www.google.com/search?q=%22Gelateria+Gino%22+Erice"], "Current web evidence did not independently corroborate the exact Gelateria Gino identity and operating status in Erice.")],
  [39, a("https://www.ristoranteorgosolo.it/", ["https://www.ristoranteorgosolo.it/", "https://www.visitaorgosolo.it/ristorante-orgosolo"], "First-party and local-tourism evidence corroborate Il Portico in Orgosolo.")],
  [40, n(["https://yandex.com/maps/org/gustos_de_orgosolo_pratobello_1969/77507820502/"], "Current map and local-event evidence corroborate the Pratobello food venue; no first-party site was found.")],
]);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.selection_id !== "session-10-national-calibration-fresh-v1" || manifest.candidates.length !== rows.size) {
  throw new Error("unexpected fresh pilot selection");
}
for (const candidate of manifest.candidates) {
  const row = rows.get(candidate.selection_index);
  if (!row) throw new Error(`missing review ${candidate.selection_index}`);
  const [venueStatus, websiteStatus, websiteUrl, evidenceUrls, notes, resources] = row;
  candidate.review = { reviewer, reviewed_at: reviewedAt, venue_status: venueStatus,
    municipality_assignment: venueStatus === "uncertain" ? "uncertain" : "correct",
    duplicate_of_venue_id: null, official_website_status: websiteStatus,
    official_website_url: websiteUrl, resources, evidence_urls: evidenceUrls, notes };
}
manifest.status = "manual_review_complete_live_run_authorized";
manifest.authorization = { live_pilot: true, national_queue: false, publication: false,
  allowance_id: "session-10-fresh-pilot-2026-09-01",
  next_gate: "build and fingerprint fresh isolated pilot before any live request" };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
