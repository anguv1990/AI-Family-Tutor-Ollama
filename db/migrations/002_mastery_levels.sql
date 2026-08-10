ALTER TABLE attempts
  ADD COLUMN outcome TEXT NOT NULL DEFAULT 'answered'
  CHECK (outcome IN ('answered', 'skipped'));

ALTER TABLE mastery
  ADD COLUMN level TEXT NOT NULL DEFAULT 'new'
  CHECK (level IN ('new', 'learning', 'secure'));

UPDATE mastery
SET level = CASE
  WHEN total_attempts = 0 THEN 'new'
  ELSE 'learning'
END;
