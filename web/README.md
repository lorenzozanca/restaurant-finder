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

## Going online (operator, one time)

1. **Neon.** Create a project in **AWS Europe Central 1 (Frankfurt)**. Copy the
   *pooled* connection string. Free plan: 0.5 GB (the app uses about 90 MB), 6 hours
   of point-in-time restore, which is why every sync also backs up the CRM tables.
2. **Google OAuth client.** Google Cloud console → Google Auth Platform → Clients →
   *Web application*. Authorized redirect URI:
   `https://<your-vercel-domain>/api/auth/callback/google` (add
   `http://localhost:3000/api/auth/callback/google` to test sign-in locally). While
   the audience is *Testing*, add your address under **Audience → Test users**.
3. **Vercel.** New project from this repository, **Root Directory `web`** (keep
   "Include files outside the root directory" on: the app imports `../lib`).
   Environment variables (Production): `DATABASE_URL`, `AUTH_SECRET`
   (`npx auth secret`), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_OWNER_EMAILS`.
   Functions run in `fra1` (`vercel.json`), next to Neon.
4. **First sync** from the repository root:
   `DATABASE_URL='<neon string>' node --no-network-family-autoselection --dns-result-order=ipv4first sync-online.mjs`
   (or put `DATABASE_URL` in the root `.env` and use `--env-file=.env`). The IPv4 flags
   are the ones bh-os needs on this laptop.
5. Open the Vercel URL on the phone and sign in with Google.

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
