# Agent-assisted ownership review batch 2 — 2026-09-08

Status: **complete; 3 Codex decisions, all verified; 3 websites passed live crawl**

## Scope and safety

- Consistent pre-write backup:
  `/tmp/italy-import-before-agent-review-batch-2-2026-09-08.sqlite`.
- Reviewer: `codex-web-review`; method: `manual_first_party_review`.
- The batch approved only candidates for which a first-party page matched the
  stored venue by address and/or phone. Search-empty, inaccessible, and
  conflicting candidates were left undecided.
- The follow-up used `enrich-attested.mjs` with three explicit venue IDs,
  three crawl requests, and zero official-site or resource-site searches.
- All 156,057 national enrichment jobs remain `queued`.

## Approved ownership attestations

1. `venue:001008:alpignano:mcdonald-s` → the first-party
   [McDonald's Alpignano branch page](https://www.mcdonalds.it/ristorante/piemonte/torino/alpignano-via-venaria),
   which matches Via Venaria 18 and telephone 0110719982.
2. `venue:001008:alpignano:napoli` →
   [pizzeria-napoli.info](https://www.pizzeria-napoli.info/); its
   [contact page](https://www.pizzeria-napoli.info/contatti-orari/) identifies
   the Alpignano business and matches telephone 0119662755. The stored source
   supplies the matching Via Silvio Marietti 5 address.
3. `venue:001011:angrogna:pomo-d-oro` →
   [locandailpomodoro.it](https://www.locandailpomodoro.it/), which names
   Locanda Il Pomo d'Oro and matches Piazza Roma 3 and telephone
   +39 3288127449.

## Deliberate abstentions

The review also considered several nearby first-party-looking candidates but
did not record decisions when first-party search was empty or the live identity
was ambiguous. In particular, Antica Cappella's current site showed the same
phone but a different street number, and Roxy Bar's current directory evidence
showed street number 104 while the source record says 107. Fratelli Milù,
Scacciapensieri, Emporio Enogastronomico, and I Rubini did not yield sufficient
first-party evidence in this pass. These remain queue items; no negative
attestation was inferred from a failed search.

## Crawl and map result

All three newly attested sites passed the independent live-page gate:

- McDonald's: accepted website plus three accepted product/menu resources.
- Pizzeria Napoli: accepted website; two menu-looking pages failed resource
  validation and remain rejected facts.
- Locanda Il Pomo d'Oro: accepted website plus one accepted event-menu image.
  That image is dated 2025, so it is useful as evidence that menus are
  published but should not be treated as a current menu without revalidation.

Resulting national state:

- Active attestations: **193 verified / 6 rejected**.
- Accepted website facts: **111**.
- Resource facts: **159 accepted / 61 rejected / 14 review**.
- `ui/verified-venues.geojson`: **111 features, 69 with menu URLs**.
- Search requests: **0**.

## Next

Continue in small, audited batches. Prefer exact first-party contact/branch
pages and leave conflicts unresolved. A separate quality pass should add
freshness handling for dated event-menu resources so an old event image is not
presented as a current menu merely because it remains reachable.
