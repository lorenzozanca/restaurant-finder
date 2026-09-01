# Session 10 offline architectural correction report

Date: 2026-09-01
Decision: **architectural correction passes offline; live decision remains NO-GO**
Brave requests used: **0**
Publication authorized: **no**

## Fixed invariant

An official website is publishable only when a trusted input supplies a
venue-scoped, timestamped publisher-ownership attestation and the candidate's
registrable domain matches the attested publisher. The pilot runner derives
those attestations only from the pinned reviewed selection: the review must
label the website accepted and record a reviewer, review time, and at least one
evidence URL.

Page-controlled observations cannot satisfy the ownership gate. Venue name,
municipality, phone, address, restaurant schema, same-domain canonical metadata,
menus, a source-provided URL, and a branded-looking domain remain useful for
relevance scoring, but none of them creates publisher ownership. An unattested
candidate can therefore be `review` or `rejected`, never `accepted`, even if it
maximizes every prior score.

This is intentionally fail-closed. It trades automatic website recall for a
publication invariant that an unseen directory cannot manufacture from its own
page. Future evidence methods such as an official registry, verified reciprocal
link, or verified merchant-platform claim must enter through the same trusted,
venue-scoped attestation boundary; they are not inferred from crawled content.

## Offline database replay

`benchmark/replay-publisher-ownership.mjs` read the accepted website facts from
both completed pilot SQLite databases and compared their publisher domains with
the pinned pre-run review records. It made no network requests and did not
modify either database.

| Pilot | Publications | Adjudicated true | True retained | Adjudicated false | False rejected |
| --- | ---: | ---: | ---: | ---: | ---: |
| Session 10 redone | 24 | 10 | 10 | 14 | 14 |
| Session 10 fresh | 14 | 5 | 5 | 9 | 9 |
| Combined | 38 | 15 | 15 | 23 | 23 |

The replay rejects every observed false publication, including the previously
unseen GialloZafferano, Grubbio, OpenDi, res-menu.net, MyCIA, and Mapstr hosts,
and retains all 15 adjudicated true publications. The Molo Factory legacy domain
is rejected because it does not match the reviewed Molo Cortina publisher.
These are retrospective retention/removal counts, not a new live precision or
recall estimate.

## Adversarial and resource regressions

The website benchmark now includes generated hostnames absent from every
blocklist. The pages claim to be official and include matching name, location,
phone, address, restaurant schema, canonical metadata, and menu resources. Both
remain unpublishable because publisher ownership is unattested.

The resource benchmark now versions the two independently adjudicated booking
errors:

- Ranch Roberta's `prenota-ora` table-reservation page is `booking`, not `order`.
- La Bastiglia's external Slope reservation page is `booking`, not `order`.

The Dish/iPratico rule remains unchanged: menu-looking routes on a verified
food-ordering surface retain the `order` role.

Offline benchmark results:

```text
Website benchmark 1.6.0-fail-closed-publisher-ownership
Official websites: 100.0% precision, 100.0% recall
Outcomes: 5 accepted, 3 review, 19 rejected

Resource benchmark 1.2-session-10-booking-role-reconciliation
Published precision: 100.0%
All six roles: 100.0% precision and recall
Hard-negative publications: 0
```

These fixture metrics validate deterministic policy behavior only.

## Provider and process fail-closed changes

- An official-site search response with `provider_failed` now stops resolution
  immediately as `provider_unavailable`.
- The durable worker converts that state into a provider pause, requeues the
  current job without consuming its attempt, records no facts, and stops other
  workers from claiming provider-dependent work.
- Completed historical pilot allowances are no longer executable. A run
  manifest must carry a new explicit `authorization.status: active` marker.
- A warm pilot is rejected unless its manifest records that cold output was
  adjudicated and the cold quality decision passed. Cold completion alone is
  insufficient.

## Decision

This offline objective is complete. Sessions 11 and 12, the Veneto queue, the
national queue, publication, and every Brave-backed validation remain blocked.
No third sample was selected and no new request allowance is requested here.
