# Benchmark labelling rules

The benchmark measures publishable precision. When evidence is insufficient,
label the item `rejected`; a later review queue may retain it, but the current
scan schema has no review outcome.

## Venue labels

- `accepted` requires evidence that the business is a food venue in the named
  municipality. OSM coordinates inside the municipality qualify for these
  fixtures. A web-only candidate needs explicit municipality evidence plus a
  compatible province, postcode, street, or independent second source.
- `rejected` covers a geographic contradiction, a generic directory or list,
  editorial content, boilerplate parsed as a name, a wrong branch, or a page
  without positive local identity evidence.
- Never treat an address created by appending the query town as evidence.
- `aliases` are human-reviewed names for one business. Cases sharing a
  `canonical_venue_id` are expected to collapse to one published venue.

## Website labels

- List only a business-controlled website or an official branch/location page
  in `official_websites`.
- Directories, booking services, social profiles, editorial pages, and pages
  for another branch are not official websites.
- Scheme changes are significant in version 1; `www`, fragments, and trailing
  slashes are ignored by URL comparison.

## Resource labels

- A resource is labelled only after both venue identity and URL role are
  supported. Correct-looking links attached to a rejected venue are false
  positives.
- Roles are exact: `menu`, `menu_image`, `order`, `drinks`, `specialty`, or
  `secondary`. A correct URL with the wrong role is both a role false positive
  and a missed expected role.
- Frozen pages and snippets are evidence used during labelling, not benchmark
  output and not publishable data.

## Fixture maintenance

Version fixture changes by creating a new `benchmark/vN` directory. Do not
rewrite an old baseline after scorer changes. A label correction may update an
existing version only when its rationale is recorded in the commit.

The Oderzo sample is curated from the checked-in August 25 scan and its scan
report. The additional strata are deliberately synthetic regression cases
using reserved `.example` domains. They exercise geography and content types
without making claims about current businesses; replace or supplement them
with independently reviewed, provenance-preserving real samples as the pilot
grows.
