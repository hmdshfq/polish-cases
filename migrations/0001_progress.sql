-- One row per person. The whole study state is a JSON document, kept small
-- (a few hundred KB at most for 1,275 items), so one row is enough and there
-- is no migration headache when the shape changes: the client owns the shape.
CREATE TABLE IF NOT EXISTS progress (
  profile    TEXT PRIMARY KEY,   -- the sync code, a random 32-character id
  rev        INTEGER NOT NULL,   -- grows with every accepted write
  data       TEXT NOT NULL,      -- the JSON document the client keeps
  items      INTEGER NOT NULL DEFAULT 0,  -- how many items it covers, for a quick glance
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS progress_updated ON progress(updated_at);
