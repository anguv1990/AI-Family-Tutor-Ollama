-- When a skill should come back.
--
-- The curriculum dataset schedules review at 1, 3, 7, 14 and 30 days. Until now
-- there was only a flat "do not repeat a question within 24 hours", which is a
-- freshness guard rather than a schedule: a skill a child had been secure in
-- for a month came round as often as one they met yesterday.
--
-- Nullable, and derived from the stored evidence rather than authoritative on
-- its own, so a parent correction or a retention prune cannot leave the
-- schedule disagreeing with the attempts it was calculated from.

ALTER TABLE mastery ADD COLUMN review_step INTEGER;
ALTER TABLE mastery ADD COLUMN next_review_at TEXT;
ALTER TABLE mastery ADD COLUMN last_practised_at TEXT;

CREATE INDEX IF NOT EXISTS idx_mastery_due
  ON mastery (child_id, next_review_at);
