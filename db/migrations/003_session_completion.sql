ALTER TABLE sessions
  ADD COLUMN ended_reason TEXT
  CHECK (ended_reason IN ('completed', 'exhausted'));

-- Before this migration the only way a session could end was by running out
-- of reviewed questions, so existing ended sessions are exhausted ones.
UPDATE sessions
SET ended_reason = 'exhausted'
WHERE ended_at IS NOT NULL AND ended_reason IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_child_active
  ON sessions (child_id, ended_at, started_at);
