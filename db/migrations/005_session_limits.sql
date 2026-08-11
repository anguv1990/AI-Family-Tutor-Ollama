-- Day 8: a session can now end because it hit the eight-answer limit or the
-- ten-minute limit, so the reason recorded by migration 003 has to widen.
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
--
-- The runner suspends foreign keys around this migration. Without that, DROP
-- TABLE sessions performs an implicit delete that cascades through
-- attempts.session_id and silently destroys every recorded attempt.

CREATE TABLE sessions_rebuilt (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  current_question_id TEXT REFERENCES content_templates(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  ended_reason TEXT CHECK (
    ended_reason IN ('completed', 'exhausted', 'question_limit', 'time_limit')
  ),
  skill_id TEXT
);

INSERT INTO sessions_rebuilt
  (id, child_id, current_question_id, started_at, ended_at, ended_reason, skill_id)
SELECT id, child_id, current_question_id, started_at, ended_at, ended_reason, skill_id
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_rebuilt RENAME TO sessions;

-- The indexes belonged to the old table and went with it.
CREATE INDEX IF NOT EXISTS idx_sessions_child_started
  ON sessions (child_id, started_at);

CREATE INDEX IF NOT EXISTS idx_sessions_child_active
  ON sessions (child_id, ended_at, started_at);

-- The 24-hour re-ask window is served by idx_attempts_child_skill
-- (child_id, template_id, created_at), which already exists.
