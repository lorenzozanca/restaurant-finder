import assert from "node:assert/strict";
import test from "node:test";
import { acceptVerifierEvidence, addressMatches, phonesMatch,
  reviewCandidate } from "./llm-ownership-reviewer.mjs";

const venue = { name: "Trattoria Da Gino", aliases: ["Da Gino"], address: "Via Giuseppe Garibaldi 12",
  municipality: "Oderzo", postcodes: ["31046"], phone: "+39 0422 123456", region: "Veneto" };
const page = "Trattoria da Gino — cucina veneta dal 1970. Via G. Garibaldi, 12 - 31046 Oderzo (TV). "
  + "Prenotazioni: tel. 0422 123456. P.IVA 01234567890";
const official = { reason: "own site", publisher_kind: "official_venue_site", decision: "official",
  name_quote: "Trattoria da Gino", municipality_quote: "31046 Oderzo (TV)",
  address_quote: "Via G. Garibaldi, 12", phone_quote: "tel. 0422 123456" };

test("accepts an official verdict whose quotes are on the page and match the record", () => {
  const result = acceptVerifierEvidence(official, venue, page);
  assert.equal(result.accepted, true, result.failures.join());
  assert.deepEqual(result.matched, ["name", "municipality", "phone", "street_address"]);
});

test("rejects invented quotes, wrong phones, and platform publishers", () => {
  const invented = acceptVerifierEvidence({ ...official, phone_quote: "0422 999999",
    address_quote: "" }, venue, page);
  assert.equal(invented.accepted, false);
  assert.ok(invented.failures.includes("phone_quote_not_on_page"));

  const otherPhone = acceptVerifierEvidence({ ...official, address_quote: "" }, { ...venue,
    phone: "041 555 0000" }, page);
  assert.deepEqual(otherPhone.failures, ["no_phone_or_address_match"]);

  const platform = acceptVerifierEvidence({ ...official, publisher_kind: "booking_or_order_platform" },
    venue, page);
  assert.ok(platform.failures.includes("publisher_kind_not_official"));

  const wrongTown = acceptVerifierEvidence({ ...official, municipality_quote: "Via G. Garibaldi" },
    { ...venue, postcodes: [] }, page);
  assert.ok(wrongTown.failures.includes("municipality_not_matched"));
});

test("phone and street matching tolerate formatting but not different numbers", () => {
  assert.equal(phonesMatch("+39 0422 123456", "0422/123.456"), true);
  assert.equal(phonesMatch("0039 347 1234567", "347-1234567"), true);
  assert.equal(phonesMatch("0422 123456", "0422 123457"), false);
  assert.equal(addressMatches("Via Giuseppe Garibaldi 12", "via g. garibaldi 12/a"), true);
  assert.equal(addressMatches("Via Giuseppe Garibaldi 12", "via garibaldi 21"), false);
  assert.equal(addressMatches("Piazza Roma", "piazza roma 3"), false);
});

function fakeClient(outputs) {
  const models = [];
  return { models, complete: async ({ model }) => {
    models.push(model);
    const json = outputs.shift();
    return { model, provider: "Test", generation_id: "g", content: JSON.stringify(json), json,
      usage: { prompt_tokens: 10, completion_tokens: 5 }, cost_usd: 0.001, finish_reason: "stop" };
  } };
}

const crawl = { final_url: "https://trattoriadagino.it/", site_facts: { visible_text: page,
  title: "Trattoria da Gino Oderzo", phones: "0422123456" } };

test("triage rejection never reaches the verifier", async () => {
  const client = fakeClient([{ reason: "delivery", publisher_kind: "booking_or_order_platform",
    decision: "not_official" }]);
  const calls = [];
  const review = await reviewCandidate({ client, triageModel: "cheap", verifierModel: "strong", venue,
    candidateUrl: "https://gino.metro.bar/", crawl, recordCall: (call) => calls.push(call) });
  assert.equal(review.outcome, "rejected");
  assert.deepEqual(client.models, ["cheap"]);
  assert.equal(calls.length, 1);
});

test("an escalated candidate is accepted only through the deterministic checks", async () => {
  const client = fakeClient([{ reason: "looks own", publisher_kind: "official_venue_site",
    decision: "escalate" }, official]);
  const review = await reviewCandidate({ client, triageModel: "cheap", verifierModel: "strong", venue,
    candidateUrl: "https://trattoriadagino.it/", crawl });
  assert.equal(review.outcome, "accepted");
  assert.deepEqual(client.models, ["cheap", "strong"]);

  const unsure = await reviewCandidate({ client: fakeClient([{ ...official, name_quote: "Da Pino" }]),
    triageModel: null, verifierModel: "strong", venue, candidateUrl: "https://trattoriadagino.it/", crawl });
  assert.equal(unsure.outcome, "ambiguous");

  const malformed = await reviewCandidate({ client: fakeClient([{ decision: "maybe" }]),
    triageModel: "cheap", verifierModel: "strong", venue, candidateUrl: "https://x.it/", crawl });
  assert.equal(malformed.outcome, "ambiguous");
  assert.deepEqual(malformed.reasons, ["invalid_triage_output"]);
});

test("a self-contradictory rejection of the venue's own site is not a rejection", async () => {
  const triageSaysOwnButNot = fakeClient([{ reason: "menu page only", publisher_kind: "official_venue_site",
    decision: "not_official" }, { ...official, decision: "insufficient" }]);
  const escalated = await reviewCandidate({ client: triageSaysOwnButNot, triageModel: "cheap",
    verifierModel: "strong", venue, candidateUrl: "https://trattoriadagino.it/menu", crawl });
  assert.deepEqual(triageSaysOwnButNot.models, ["cheap", "strong"]);
  assert.equal(escalated.outcome, "ambiguous");

  const verifierContradiction = await reviewCandidate({ client: fakeClient([{ ...official,
    decision: "not_official" }]), triageModel: null, verifierModel: "strong", venue,
    candidateUrl: "https://trattoriadagino.it/", crawl });
  assert.deepEqual(verifierContradiction.reasons, ["verifier_inconsistent_rejection"]);
});
