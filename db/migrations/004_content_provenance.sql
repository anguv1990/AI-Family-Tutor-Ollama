-- Day 4: give every template a recorded source/licence and a teaching order,
-- and bind a session to one skill so selection cannot drift across skills once
-- more than one skill is enabled.

ALTER TABLE content_templates ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE content_templates ADD COLUMN licence TEXT NOT NULL DEFAULT '';

-- Ordering within a difficulty band. Lower is taught first; the seed sets it.
ALTER TABLE content_templates ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;

-- Everything in the bank before this migration was written for this project.
UPDATE content_templates
SET source = 'AI Family Tutor original content', licence = 'CC0-1.0'
WHERE source = '';

-- SQLite forbids a REFERENCES clause on ADD COLUMN unless the default is NULL,
-- so this is backfilled instead of declared as a foreign key.
ALTER TABLE sessions ADD COLUMN skill_id TEXT;

UPDATE sessions
SET skill_id = 'reception.addition-within-5'
WHERE skill_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_templates_skill_selection
  ON content_templates (skill_id, reviewed, enabled, difficulty, sequence);
