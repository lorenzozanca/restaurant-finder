-- CRM views (PROCESS.md, "CRM views"): contacts, the contact involved in an activity,
-- and saved table views. Applied by lib/online-db.mjs.

-- The people the operator deals with at a venue. Business contact data only
-- (PRIVACY.md, "Venue contacts"); deleting a row is the erasure route. The venue's
-- name and town are copied in so the contacts table needs no venue lookup.
CREATE TABLE contacts (
  id bigserial PRIMARY KEY,
  venue_id text NOT NULL,
  venue_name text NOT NULL,
  municipality text NOT NULL DEFAULT '',
  province text NOT NULL DEFAULT '',
  name text NOT NULL CHECK (name <> ''),
  role text NOT NULL DEFAULT '' CHECK (role IN ('', 'owner', 'manager', 'chef', 'staff', 'other')),
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  preferred_channel text NOT NULL DEFAULT ''
    CHECK (preferred_channel IN ('', 'visit', 'phone', 'email', 'letter')),
  source text NOT NULL
    CHECK (source IN ('in_person', 'business_card', 'venue_website', 'phone_call', 'other')),
  notes text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_venue ON contacts (venue_id, id);
CREATE INDEX contacts_name ON contacts (lower(name), id);
CREATE INDEX contacts_venue_name ON contacts (lower(venue_name), id);
CREATE INDEX contacts_updated ON contacts (updated_at DESC, id DESC);

-- Who a touch was with. Erasing the contact keeps the activity without them.
ALTER TABLE pipeline_events ADD COLUMN contact_id bigint REFERENCES contacts (id) ON DELETE SET NULL;
CREATE INDEX pipeline_events_happened ON pipeline_events (happened_on DESC, id DESC);

-- Named filter/sort settings of a table page (the page's URL query string).
CREATE TABLE saved_views (
  id bigserial PRIMARY KEY,
  page text NOT NULL CHECK (page IN ('leads', 'contacts', 'activities')),
  name text NOT NULL CHECK (name <> ''),
  query text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page, name)
);
