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
- Every API route answers 401 without an allowed session; the proxy only redirects
  early. Tiles are cached `private`.
- The database holds business records, your notes, and your email as author of each
  change. No passwords, no Pomovi database credentials.
