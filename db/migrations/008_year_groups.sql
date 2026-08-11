-- Two children, two year groups. Until now every skill was Reception and every
-- answer was a whole number 0-10 tapped from a row, so neither the child nor
-- the skill needed to say which curriculum it belonged to.
--
-- A Year 3 child must never be served Reception questions, and a Reception
-- child must never be shown a keypad, so the year group is recorded on both
-- sides and matched at selection time rather than inferred from the id prefix.
--
-- Existing rows default to reception, which is what every seeded skill and
-- every existing child actually is.

ALTER TABLE children ADD COLUMN year_group TEXT NOT NULL DEFAULT 'reception'
  CHECK (year_group IN ('reception', 'year3'));

ALTER TABLE skills ADD COLUMN year_group TEXT NOT NULL DEFAULT 'reception'
  CHECK (year_group IN ('reception', 'year3'));

-- How the child enters an answer for this skill. It changes the input surface
-- only: marking stays an exact match on a whole number either way.
ALTER TABLE skills ADD COLUMN answer_entry TEXT NOT NULL DEFAULT 'tap-0-10'
  CHECK (answer_entry IN ('tap-0-10', 'keypad'));

CREATE INDEX IF NOT EXISTS idx_skills_year_group
  ON skills (year_group, enabled);
