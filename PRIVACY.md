# Privacy and retention process

Last reviewed: 2026-08-24

This is the operating process for Restaurant Finder, not a completed public
privacy notice or legal opinion. Before deployment, replace every bracketed
item, approve the legitimate-interests assessment, and adapt the process to the
actual hosting, search provider, recipients, and Member State requirements.

## Ownership and release gate

- Controller: **[legal name and postal address]**
- Privacy contact: **[email address]**
- EU representative, if required: **[name/contact or not applicable]**
- DPO, if required: **[name/contact or not applicable]**
- Process owner: **[role]**

Do not make the service public until the controller has:

1. completed and signed a legitimate-interests assessment (purpose, necessity,
   balancing, safeguards, and alternatives) for GDPR Article 6(1)(f), or
   documented another applicable legal basis;
2. published an Articles 13/14-compliant notice identifying the controller,
   purposes, data categories, sources, legal basis, recipients, transfers,
   retention, rights, complaint route, and any automated decision-making;
3. decided whether Article 14 requires direct notice to identifiable sole
   traders or contacts, and documented any exception relied on;
4. recorded processors, contracts, hosting locations, international-transfer
   safeguards, access roles, and a breach-response contact; and
5. verified all source terms and attribution using
   [`DATA-LICENSING.md`](DATA-LICENSING.md).

## Processing register

Purpose: help users find restaurants and public menu/resource links for a town.
Do not reuse the data for profiling, direct marketing, eligibility decisions,
or enrichment unrelated to that purpose without a new legal-basis and
compatibility assessment.

Data subjects may include sole traders, named proprietors, or individuals whose
direct contact details appear on a public venue page. A public business record
is not automatically outside GDPR.

| Category | Examples | Source | Storage |
| --- | --- | --- | --- |
| Search input and run metadata | Town, province, search date, progress events | User/operator and application | Result JSON and log |
| Venue identity/location | Name, type, address, coordinates, cuisine, OSM ID | OSM/Nominatim, search results, public websites | Result JSON |
| Contact/link data | Phone number, website, directory URL, menu/resource URL | OSM/Nominatim and public websites | Result JSON |
| Discovery evidence | Search title, snippet, fetched HTML, request URL | Search provider and public websites | Transient cache only; snippets are removed from result JSON |

The application itself has no user accounts, cookies, analytics, or persistent
IP-address log. Hosting platforms, reverse proxies, DNS providers, and the
external search tool may process additional data; the controller must add them
to the register and public notice.

## Minimisation and accuracy

- Collect only fields used for venue discovery, deduplication, display, or
  source verification. Never submit confidential or special-category data to
  Nominatim or search providers.
- Do not add reviews, customer information, private contact details, inferred
  traits, or downloaded menu media to the output.
- Prefer an official business contact over a named individual's direct contact.
  Remove a field when its relevance cannot be justified.
- Show the source and search date. Treat results as leads, not verified truth.
  Correct or remove disputed data promptly and refresh stale data rather than
  silently retaining it.

## Retention schedule

| Data | Default maximum | Disposal |
| --- | ---: | --- |
| `output/<town>/*.json` scan results | 30 days | Delete |
| `output/<town>/*.log.json` progress logs | 14 days | Delete |
| `output/.cache/*` fetched/search responses | 1 day | Delete |
| Backups containing deleted data | 30 additional days | Expire through backup rotation; restrict restoration until then |
| Data-subject request and erasure audit | 3 years after closure, containing only request date, decision, action, and minimal identity evidence | Delete or aggregate |

Run `node retention.mjs` to preview expired files and
`node retention.mjs --apply` to delete them. Schedule the apply command at least
daily. Override the first three periods with `RESULT_RETENTION_DAYS`,
`LOG_RETENTION_DAYS`, and `CACHE_RETENTION_DAYS`; document and approve any
override. The command uses file modification time, skips symbolic links and
unknown files, and never deletes before `--apply` is supplied.

Quarterly, the process owner must sample the output directory, verify the job
ran, test restoration does not reintroduce expired production data, and record
the check. A legal hold must identify its authority, scope, owner, start date,
review date, and end condition; do not suspend retention for unrelated data.

## Data-subject request procedure

Use one ticket per request and restrict it to authorised staff.

1. Record receipt time, requested right, contact channel, and deadline. Respond
   without undue delay and normally within one month (GDPR Article 12).
2. Verify identity proportionately. Do not collect identity documents unless
   needed; redact and delete verification evidence as soon as verification is
   complete.
3. Search result JSON, logs, cache (by URLs/terms where practicable), active
   memory, and relevant backups/processors using the person's name, business,
   phone, address, URLs, and source IDs. Record systems and queries checked.
4. Assess access, source information, correction, erasure, restriction,
   portability, or objection as applicable. For an Article 21 objection to
   legitimate-interest processing, restrict the disputed record while the
   controller assesses compelling grounds.
5. Correct or remove the matching fields/records from every live result and
   cache; regenerate affected summary/map views. Notify recipients and
   processors where required. Mark backup copies for non-restoration and allow
   normal backup expiry unless immediate deletion is technically required.
6. Reply in clear language with the action, retained data and reason, complaint
   route, and appeal/escalation contact. Keep only the minimal audit row in the
   retention table above.

If a deleted record is rediscovered on a later scan, the process owner must use
the least intrusive effective suppression control consistent with source
licences and document it. Do not keep the removed personal data merely to build
a suppression list without assessing the legal basis for that list.

## Security and incidents

- The built-in server binds to `127.0.0.1` by default. The application itself has
  no authentication or authorisation, so `HOST` only accepts a loopback address or
  a Tailscale address in `100.64.0.0/10`, where tailnet membership and ACLs
  authenticate every peer. Any other interface — including `0.0.0.0` — is refused
  unless the operator sets `ALLOW_WIDE_BIND=1`, which asserts that they have put
  their own authenticated access in front of it.
- The server rejects requests whose `Host` header is not the bound address, a
  loopback name, a tailnet name, or an entry in `ALLOWED_HOSTS`, and rejects
  cross-origin writes on the same rule. This blocks DNS rebinding from a browser
  that can reach the bound address.
- Restrict filesystem and backup access, use encryption in transit and at rest,
  patch dependencies/runtime, keep secrets out of output, and do not commit
  `output/` (it is git-ignored).
- Do not expose caches or logs through static hosting. Review logs before
  support sharing and redact contact data and URLs containing identifiers.
- Test access controls and the retention job after material changes.
- On a suspected breach: contain it, preserve a minimal incident record, assess
  risk and affected people/data, engage the controller immediately, and make
  any supervisory-authority notification within 72 hours where Article 33
  requires it. Notify affected people where Article 34 requires it.

The process reflects GDPR principles including purpose limitation, data
minimisation, accuracy, storage limitation, and security, and the rights to
rectification, erasure, and objection. The authoritative text is
[Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
