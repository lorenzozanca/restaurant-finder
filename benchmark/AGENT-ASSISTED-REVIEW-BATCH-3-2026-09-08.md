# Agent-assisted ownership review batch 3 — 2026-09-08

Status: **complete; 3 Codex approvals; 1 website passed live crawl**

## Scope and safety

- Consistent pre-write backup:
  `/tmp/italy-import-before-agent-review-batch-3-2026-09-08.sqlite`.
- Reviewer: `codex-web-review`; method: `manual_first_party_review`.
- The batch was limited to three Avigliana venues with venue-specific pages
  matching stored phone and location evidence.
- Crawl-only enrichment used explicit venue IDs, zero official-site searches,
  and zero resource-site searches. All 156,057 national jobs remain `queued`.

## Approved ownership attestations

1. `venue:001013:avigliana:al29` →
   [osteria-al29.campingavigliana.it](https://osteria-al29.campingavigliana.it/).
   The first-party subsite names Osteria Al29, places it in Avigliana, and
   matches the stored +39 3313538987 phone.
2. `venue:001013:avigliana:avilius-caffetteria-osteria` corrected from the
   `cooperto.it` booking candidate to the venue-specific
   [Webnode site](https://avilius-caffetteria-osteria.webnode.it/). Its
   [contact page](https://avilius-caffetteria-osteria.webnode.it/contatti/)
   matches Corso Laghi 147/149 and +39 3408402094; the
   [municipal listing](https://www.comune.avigliana.to.it/it-it/vivere-il-comune/dove-mangiare/avilius-caffetteria-osteria-53827-1-325911211c17830297215feb38cfb16a)
   independently corroborates both.
3. `venue:001013:avigliana:del-lago` → the venue-specific
   [Eatbu page](https://osteriadellago.eatbu.com/?lang=it), which matches Via
   Giaveno 23 and +39 3315050822.

## Deliberate abstentions

No decision was recorded for Antica Cappella because its matching phone was
paired with a conflicting street number. Chalet del Lago's stored domain now
serves a differently branded beach club with a different phone. Ciclocucina
and Trattoria Croce Bianca lacked sufficient first-party identity evidence in
this pass. Osteria del Pellegrino had strong municipal identity evidence but
not enough evidence that the candidate domain is still controlled by the
venue. No failed lookup became a rejection.

## Independent crawl outcome

- Osteria del Lago: accepted website; no accepted resource.
- Osteria Al29: `crawl_only_candidates_not_accepted` after two crawls.
- Avilius: `crawl_only_candidates_not_accepted` after two crawls.

The latter two ownership attestations remain active, but neither is published
as a website fact or map feature. This demonstrates that human ownership
review and live-page publication remain separate gates.

Resulting national state:

- Active attestations: **196 verified / 6 rejected**.
- Accepted website facts: **112**.
- Resource facts: **159 accepted / 62 rejected / 14 review**.
- `ui/verified-venues.geojson`: **112 features, 69 with menu URLs**.
- Search requests: **0**.

## Next

Stop sequential queue review: these small batches were calibration, not the
scaling mechanism. Next produce the read-only national backlog census defined
in [`VERIFIED-VENUES-SCALING-STRATEGY.md`](VERIFIED-VENUES-SCALING-STRATEGY.md),
then measure automatic-verification eligibility without publishing. Separately
inspect the Al29 and Avilius crawl signals before changing any scoring rule;
their manual evidence alone must not bypass the live-page gate.
