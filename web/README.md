# restaurant-finder — online lead CRM

The national lead map plus the sales pipeline, online and private
(`PROCESS.md` → "Online lead CRM"). It serves the same `ui/map.html` as the laptop's
`ui/server.mjs`, from the snapshot `sync-online.mjs` uploads, and adds the pipeline on
every venue card, a Pipeline tab, and a stage filter.

What lives where:

- **Laptop:** crawling, LLM review, the national store. `node sync-online.mjs` applies
  the manual decisions made online, then uploads the map snapshot and the per-venue
  review details, and copies the CRM tables to `data/online-backups/`.
- **Online (this app, Vercel + Neon):** the pipeline and manual decisions. Nothing
  here changes what counts as verified until the laptop syncs.

## Local development

```bash
cd web
npm install
cp .env.example .env.local        # DATABASE_URL (local), AUTH_DEV_EMAIL, AUTH_OWNER_EMAILS
npm run db:local                  # terminal 1: Postgres (PGlite) on 127.0.0.1:5434
npm run sync:local                # migrates, then uploads the national map (~10 s)
npm run dev                       # http://127.0.0.1:3000
```

`AUTH_DEV_EMAIL` stands in for a signed-in user so pages and APIs open without the
Google flow; it is ignored in production. `sync:local` passes `--no-reviews`, so manual
decisions made against the local database never reach the real national store.

## Online (set up 2026-09-27)

- **URL:** <https://restaurants.trelua.com> (added 2026-09-27: a CNAME at Hostinger,
  where trelua.com's DNS lives, to `78e539ce3f31b4e2.vercel-dns-017.com`). Also
  <https://restaurant-finder-iota.vercel.app> and
  `restaurant-finder-lorenzozanca.vercel.app`. Vercel project `restaurant-finder`,
  team `lorenzozanca`, Hobby, Root Directory `web`, functions in `fra1`.
- **Database:** Neon `restaurant-finder` (free plan `free_v3`, AWS eu-central-1),
  created through Vercel's Neon integration, which sets `DATABASE_URL` (pooled) and
  friends on the project. The repository root is linked (`.vercel/`), and
  `vercel env pull` writes them to the root `.env.local` (gitignored).
- **Sync** from the repository root, after each publish:
  `node --no-network-family-autoselection --dns-result-order=ipv4first --env-file=.env.local sync-online.mjs`
  (the IPv4 flags are the ones bh-os needs on this laptop; about 35 s the first time).
- **Deploy** from the repository root: `npx vercel deploy --prod`. `.vercelignore` is an
  allowlist (`web/`, `lib/`, `ui/`): the CLI does not read `.gitignore`, and `data/`
  holds 8 GB of stores.
- **Sign-in:** Google OAuth web client with the redirect URIs
  `https://restaurants.trelua.com/api/auth/callback/google`,
  `https://restaurant-finder-iota.vercel.app/api/auth/callback/google` and
  `https://restaurant-finder-lorenzozanca.vercel.app/api/auth/callback/google` (Auth.js
  uses the host the app was opened on, so each address needs its own); its ID
  and secret are `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (Production), with
  `AUTH_SECRET` and `AUTH_OWNER_EMAILS`. A changed variable needs a redeploy. While the
  OAuth audience is *Testing*, the address must be listed under Audience → Test users.

Neon's free plan: 0.5 GB (the app uses about 90 MB) and 6 hours of point-in-time
restore, which is why every sync also backs up the CRM tables to `data/online-backups/`.
Hobby is for non-commercial use: move the project to Pro when the app is first used
to contact a venue.

## Pomovi bridge

Set `POMOVI_BRIDGE_URL` (e.g. `https://app.pomovi.com`) and `POMOVI_BRIDGE_TOKEN`
once Pomovi ships `../pomovi/docs/plans/restaurant-finder-bridge.md` (the same token
as Pomovi's `RESTAURANT_FINDER_BRIDGE_TOKEN`). Then the venue card shows **Create demo
in Pomovi**, and the Pipeline tab **Refresh from Pomovi** (demo ready when it has a
menu, won when the venue is active).

## Security

- Google sign-in only; `AUTH_OWNER_EMAILS` is checked at sign-in and again on every
  data request (`lib/session.ts`), so removing an address locks it out at once.
- Operator API routes answer 401 without an allowed session; the proxy only
  redirects early. The two Pomovi inbound routes below require their own bearer
  credential and never accept a Google session instead. Tiles are cached `private`.
- The database holds business records, your notes, and your email as author of each
  change. No passwords, no Pomovi database credentials.

## Pomovi self-signup catalogue and notifications

The inbound integration for Pomovi's `signup-and-trial` project is implemented but
**not deployed or configured**. It uses `POMOVI_INBOUND_TOKEN`, a separate, random
server-only credential from the outbound `POMOVI_BRIDGE_TOKEN`. Set the inbound
value on both servers during Pomovi's approved step-10 rollout. Do not put it in
browser code. Unset/blank: the supported calls return 404; missing/wrong bearer:
401. A Google session does not admit these calls. Responses use `Cache-Control:
no-store`. Only these exact two paths bypass the OAuth proxy, and each authenticates
before loading the catalogue or touching Postgres.

- `GET /api/pomovi/search?q=caffe[&municipality=Treviso]`: name prefix, case/accent
  insensitive; 3–80 normalised characters, optional exact municipality (also
  case/accent insensitive, ≤100 characters), at most 10 results. Each has `ref`,
  `name`, `address`, `municipality`, `province`, `region` (ISTAT code), `website`
  (HTTP(S) or null) and `website_status` (`verified | candidate | none`). Rejected
  and directory websites are omitted. Pending approved manual reviews use their
  approved URL. The existing in-memory `LeadIndex` supplies the data; there is no
  additional catalogue database or provider call.
- `GET /api/pomovi/search?municipality=Treviso&all=1[&province=TV]`: a town's whole
  list for Pomovi's town-first search (2026-10-19), in name order, at most 500
  (`TOWN_LIST_LIMIT`), with `truncated: true` when the town has more (Roma, Milano
  and a few other cities; Pomovi then searches by name within the town). `province`
  (two letters) is also accepted by the name search, and tells apart the four names
  two towns share. Same result fields. The town map is built once per instance
  (~0.4 s on the national index), then a list costs its own size.
- `GET /api/pomovi/search?ref=<encoded-id>`: exact lookup for the Pomovi backend
  before trusting a submitted catalogue reference. Returns zero or one result;
  cannot be combined with `q` or `municipality`.
- `POST /api/pomovi/signups`: JSON `{ref, signup_id, stage}`. `signup_id` is Pomovi's
  positive integer row ID; `stage` is `demo_requested` or `demo_ready`. Extra fields
  and bodies over 4 KB are refused. Send no signup name, email, phone or password.
  Result: `{stage, duplicate}`; unknown venue 404, do-not-contact 409.

Notifications go through the CRM layer, in one transaction. One lead per catalogue
reference, and one system note (`self-signup:<signup_id>:<stage>`, author
`pomovi:self-signup`) per notification. Unique insertion plus a row lock makes retries
safe, including racing and out-of-order requests. Automatic movement is only
`shortlisted → demo_requested → demo_ready`. Existing contacted, follow-up, won and
lost stages and next actions remain the operator's; do-not-contact refuses the
notification without a note. An automatic notification cannot set won or reopen a
venue. No migration is needed and no manual website-review decision is written.

The response includes `attribution`: the consuming signup UI must display Overture
Maps Foundation Places (CDLA-Permissive-2.0) and `© OpenStreetMap contributors` with
the appropriate source links (`../DATA-LICENSING.md`). Pomovi's public API adapts
`website_status` to its UI's `websiteStatus` field.

Local production-mode verification on snapshot `3a86b85efbc5` (156,057 venues):
2,162 ms first authenticated request; 20 warm requests median 6 ms, maximum 10 ms.
This is a local result, **not a Vercel Hobby cold-start measurement**. Capture the
Hobby timing at the approved rollout, using the existing `lead index … fetch … ms,
build … ms` runtime log plus the authenticated request timing.
