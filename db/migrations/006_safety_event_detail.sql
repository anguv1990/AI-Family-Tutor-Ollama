-- The AI gateway records why it rejected, blocked or fell back. The original
-- safety_events table only held an event type, which tells an adult that
-- something happened but not what or where — useless for the parent-visible
-- fallback state that plan.md requires.
--
-- Every column is nullable so existing rows stay valid without a backfill.
--
-- `detail` holds rule identifiers and validation messages only. Model text and
-- child answers must never be written here: an audit trail must not become a
-- copy of the content we refused to show.

ALTER TABLE safety_events ADD COLUMN task TEXT;
ALTER TABLE safety_events ADD COLUMN prompt_version TEXT;
ALTER TABLE safety_events ADD COLUMN provider TEXT;
ALTER TABLE safety_events ADD COLUMN model TEXT;
ALTER TABLE safety_events ADD COLUMN reason TEXT;
ALTER TABLE safety_events ADD COLUMN detail TEXT;

CREATE INDEX IF NOT EXISTS idx_safety_events_created
  ON safety_events (created_at);
