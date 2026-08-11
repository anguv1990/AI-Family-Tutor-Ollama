-- Why an answer was wrong, not just that it was.
--
-- The curriculum dataset names the misconceptions worth looking for; the
-- pattern recorded here is what was actually read off the answer the child
-- gave. It is diagnostic only and never affects marking or mastery: the answer
-- was already marked before this was worked out.
--
-- Nullable: a correct answer has no misconception, and a wrong answer may not
-- match any known pattern.

ALTER TABLE attempts ADD COLUMN misconception TEXT;

CREATE INDEX IF NOT EXISTS idx_attempts_misconception
  ON attempts (child_id, misconception);
