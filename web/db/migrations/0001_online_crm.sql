-- Online lead CRM (PROCESS.md, "Online lead CRM"). Applied by lib/online-db.mjs,
-- which records each file in schema_migrations.

-- The map snapshot the laptop builds (lib/map-snapshot.mjs format), gzipped. The
-- newest row is the one the app serves; sync-online.mjs keeps the last two.
CREATE TABLE map_snapshots (
  version text PRIMARY KEY,
  built_at timestamptz NOT NULL,
  store_stamp double precision NOT NULL,
  venue_count integer NOT NULL,
  stats jsonb NOT NULL,
  payload bytea NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- Why each venue has its status: candidates, attestations, crawl assessments and
-- the latest LLM reviewer outcome (lib/venue-details.mjs). Pushed only when changed.
CREATE TABLE venue_details (
  venue_id text PRIMARY KEY,
  detail jsonb NOT NULL,
  detail_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Manual ownership decisions made online. They reach the national store only when
-- sync-online.mjs replays them through recordReviewDecision on the laptop.
CREATE TABLE manual_reviews (
  id bigserial PRIMARY KEY,
  venue_id text NOT NULL,
  candidate_domain text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  body jsonb NOT NULL,
  decided_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  apply_error text,
  attestation jsonb
);
CREATE INDEX manual_reviews_pending ON manual_reviews (id) WHERE applied_at IS NULL;
CREATE INDEX manual_reviews_venue ON manual_reviews (venue_id, id);

-- The sales pipeline: one row per venue in it. Rows are never deleted; leaving the
-- pipeline is a stage (lost, do not contact).
CREATE TABLE pipeline (
  venue_id text PRIMARY KEY,
  venue_name text NOT NULL,
  municipality text NOT NULL DEFAULT '',
  province text NOT NULL DEFAULT '',
  stage text NOT NULL CHECK (stage IN ('shortlisted', 'demo_requested', 'demo_ready', 'contacted',
    'follow_up', 'won', 'lost', 'do_not_contact')),
  next_action text NOT NULL DEFAULT '',
  next_action_on date,
  lost_reason text NOT NULL DEFAULT '',
  pomovi_venue_id integer,
  pomovi_slug text,
  pomovi_status text,
  pomovi_public_url text,
  pomovi_wizard_url text,
  pomovi_menu_items integer,
  pomovi_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_next_action ON pipeline (next_action_on);

-- Everything that happened to a venue in the pipeline, newest last.
CREATE TABLE pipeline_events (
  id bigserial PRIMARY KEY,
  venue_id text NOT NULL REFERENCES pipeline (venue_id),
  kind text NOT NULL CHECK (kind IN ('stage', 'visit', 'card', 'letter', 'call', 'email', 'note', 'demo')),
  stage_from text,
  stage_to text,
  note text NOT NULL DEFAULT '',
  happened_on date NOT NULL DEFAULT current_date,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_events_venue ON pipeline_events (venue_id, id);

CREATE TABLE sync_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL
);
