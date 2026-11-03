-- The revision now counts up on the server, so nothing filters or orders by
-- updated_at: the index cost a write on every save and answered no query.
DROP INDEX IF EXISTS progress_updated;
