-- Days 21-25: parent corrections, per-child wellbeing settings, retention.

-- plan.md: "At most one session per child per day by default, adjustable by
-- the parent." This is a wellbeing control for a four-to-five-year-old, so it
-- lives with the child rather than in global settings.
ALTER TABLE children ADD COLUMN daily_session_limit INTEGER NOT NULL DEFAULT 1;

-- A parent correction never overwrites what the child actually did. is_correct
-- keeps the recorded result forever; this column carries the adult's judgement
-- and is what mastery reads. NULL means "no correction in force", which is also
-- how a reversal restores the original evidence.
ALTER TABLE attempts ADD COLUMN corrected_is_correct INTEGER
  CHECK (corrected_is_correct IN (0, 1));

-- Append-only audit trail. A reversal adds a row; it never edits or removes
-- the row that applied the correction.
CREATE TABLE IF NOT EXISTS attempt_corrections (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('applied', 'reversed')),
  original_is_correct INTEGER NOT NULL CHECK (original_is_correct IN (0, 1)),
  corrected_is_correct INTEGER CHECK (corrected_is_correct IN (0, 1)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_corrections_child
  ON attempt_corrections (child_id, created_at);

CREATE INDEX IF NOT EXISTS idx_corrections_attempt
  ON attempt_corrections (attempt_id, created_at);

-- Adult-facing settings that are not per child: retention periods and the
-- record of when retention last ran. Key/value so adding a control later does
-- not need a migration.
CREATE TABLE IF NOT EXISTS parent_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Deletion and export both walk safety events by session.
CREATE INDEX IF NOT EXISTS idx_safety_events_session
  ON safety_events (session_id, created_at);
