# Labelling the LLM-review locked holdout (v1)

You are labelling reference data for a locked holdout. An automatic website reviewer
will later be scored against your labels, so your labels must be independent of it.

## Rules of independence

- Read only this file and the one packet you were given in `labelling/`. You may use
  the web freely (open the candidate URL, search, open other sites).
- Never open `data/llm-review/`, any other file in this repository, or any other
  batch's labels. Running the format check at the end of this file is allowed. Never call OpenRouter, and never use the `xiaomi/mimo-*` models.
- Work in a fresh session for each packet. Do not reuse a session that has seen
  reviewer output.

## Your packet

`labelling/packet-AAA-BBB.json` lists 48 venues. Each has the record the reviewer
also receives (name, aliases, address, postcode, municipality, region code, phone),
plus:

- `candidate_url`: the website the source inventory (Overture) supplied. This is the
  URL you judge.
- `candidate_registrable_domain`: its registrable domain. Copy it exactly.

Write your labels to `locked-holdout-adjudication-AAA-BBB.json` in this directory,
the file named by the packet's `output_file`.

## The question for every venue

**Is the candidate's domain the official website of this venue?** "Official" means
that the business operating this venue controls the domain and uses it for this
venue:

- The venue's own site, identified by its name and municipality, with an address,
  phone, VAT number, or other detail consistent with the record.
- The site of the hotel, agriturismo, winery, club, or group that runs the venue, if it
  presents this venue.
- A chain's or brand's domain, if the chain operates this exact location and the
  domain lists it (a store-locator entry counts).
- A site on the venue's own domain built with an ordering, booking, or website
  platform. Judge who controls the domain, not the software behind it.

Not official (`rejected`):

- Social profiles (Facebook, Instagram, TikTok, …).
- Directories, guides, review sites, tourism or municipal portals (TripAdvisor,
  PagineGialle, RestaurantGuru, a comune's "Guida al paese", …).
- Booking, delivery, or menu platforms on their own shared domain (TheFork, JustEat,
  Deliveroo, Glovo, leggimenu, a menu-hosting subdomain, …).
- Editorial or press pages.
- A domain that now serves another business, a different venue with a similar name,
  another branch, or a parked, expired, or for-sale domain.

Use `uncertain` only when, after a real attempt, you cannot decide: for example, the
site is unreachable and nothing else shows who controls it, or a chain page names the
brand but you cannot tie this location to it. Explain why in `uncertainty_reason`.

If the candidate redirects to another domain, judge the candidate domain by whether
the venue controls the redirect (a venue moving its own site counts as control), and
put the final URL in the optional `final_url` field of that domain review.

If you find the venue's official website elsewhere (not on the candidate domain),
record it in the optional `other_official_website_url` field of the venue entry. The
candidate verdict is still `rejected` or `uncertain`.

Name what matched in every `rationale` (for example "name, Via Roma 12 and
+39 0422 123456 on the contact page"), or what contradicted it.

## Output format

One JSON document per packet. Copy `adjudication_header` from the packet and add
`reviewer`, `reviewed_at`, `review_basis`, `scope_limitations`, and `entries`.

- `reviewer`: the agent and model, for example
  `"Claude Opus 5.5 operator-run holdout labelling"`.
- `reviewed_at` and every `*_reviewed_at`: ISO 8601 timestamps.
- One entry per packet venue, in any order, each with:
  - `venue_id`: copied from the packet.
  - `official_website_status`: `accepted` when the candidate domain is `verified`;
    otherwise `no_official_site` when the candidate is `rejected`, or `uncertain`.
  - `official_website_url`: the candidate URL (or another page on the same domain)
    when `accepted`, else `null`.
  - `evidence_urls`: exactly `[candidate_url]`.
  - `domain_reviews`: exactly one object for `candidate_registrable_domain`:
    - `registrable_domain`: copied from the packet.
    - `publisher_class`: one of `official`, `directory`, `menu_mirror`,
      `booking_or_order_platform`, `editorial_or_review`, `social`, `unrelated`,
      `uncertain`.
    - `ownership_status`: `verified` (requires `publisher_class: "official"`),
      `rejected`, or `uncertain`.
    - `evidence_urls`: exactly `[candidate_url]`.
    - `rationale`: required, one or two sentences.
    - For `verified` only: `ownership_method: "manual_first_party_review"`,
      `ownership_reviewed_at`, and `ownership_evidence_urls` (the pages that proved
      it, any http(s) URL).
    - For `uncertain` only: `uncertainty_reason`, `uncertainty_reviewed_at`, and
      `uncertainty_evidence_urls` (the pages you tried).
    - `rejected` has none of those extra fields.

## Example

A fake one-venue document. The test suite validates this exact block, so it is
always a valid format.

```json
{
  "schema_version": 1,
  "adjudication_set": "llm-review-holdout-v1-adjudication-001-001",
  "partition": "locked_holdout",
  "source": "independent_fixture_review",
  "selection_fingerprint_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "reviewer": "Example agent operator-run holdout labelling",
  "reviewed_at": "2026-09-25T09:00:00.000Z",
  "review_basis": "Opened each candidate URL and its contact pages; web search to confirm address and phone.",
  "scope_limitations": "Unreachable sites were retried once and labelled uncertain.",
  "entries": [
    {
      "venue_id": "venue:000000:esempio:trattoria-esempio",
      "official_website_status": "accepted",
      "official_website_url": "https://www.trattoriaesempio.example/",
      "evidence_urls": ["https://www.trattoriaesempio.example/"],
      "domain_reviews": [
        {
          "registrable_domain": "trattoriaesempio.example",
          "publisher_class": "official",
          "ownership_status": "verified",
          "evidence_urls": ["https://www.trattoriaesempio.example/"],
          "rationale": "Home page names Trattoria Esempio in Esempio, Via Roma 1, and the record's phone.",
          "ownership_method": "manual_first_party_review",
          "ownership_reviewed_at": "2026-09-25T09:00:00.000Z",
          "ownership_evidence_urls": ["https://www.trattoriaesempio.example/contatti"]
        }
      ]
    }
  ]
}
```

A rejected candidate's domain review looks like:

```json
{
  "registrable_domain": "tripadvisor.it",
  "publisher_class": "directory",
  "ownership_status": "rejected",
  "evidence_urls": ["https://www.tripadvisor.it/Restaurant_Review-g1-d1-Reviews-Esempio.html"],
  "rationale": "TripAdvisor listing, not controlled by the venue."
}
```

## Check your file

From the repository root:

```bash
node validate-holdout-labels.mjs --holdout-dir benchmark/llm-review-holdout-v1 \
  --file locked-holdout-adjudication-AAA-BBB.json
```

It checks your label file against the fixture and its packet (reading no reviewer
output). Fix any error it reports. Do not run it with `--seal`; the operator
seals the complete set.
