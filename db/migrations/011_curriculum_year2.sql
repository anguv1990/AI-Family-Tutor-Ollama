-- Year 2 joins Reception and Year 3, and the curriculum dataset in Modal_data
-- becomes the source of truth for how skills relate to one another.
--
-- SQLite cannot widen a CHECK constraint in place, so the two tables carrying
-- year_group are rebuilt. Foreign keys are suspended around this by the
-- migration runner (rebuildsTable), because dropping `skills` with them on
-- would cascade into content_templates and mastery.

CREATE TABLE skills_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  curriculum_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  year_group TEXT NOT NULL DEFAULT 'reception'
    CHECK (year_group IN ('reception', 'year2', 'year3')),
  answer_entry TEXT NOT NULL DEFAULT 'tap-0-10'
    CHECK (answer_entry IN ('tap-0-10', 'keypad'))
);

INSERT INTO skills_new (id, title, curriculum_version, enabled, year_group, answer_entry)
  SELECT id, title, curriculum_version, enabled, year_group, answer_entry FROM skills;

DROP TABLE skills;
ALTER TABLE skills_new RENAME TO skills;

CREATE TABLE children_new (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  year_group TEXT NOT NULL DEFAULT 'reception'
    CHECK (year_group IN ('reception', 'year2', 'year3')),
  daily_session_limit INTEGER NOT NULL DEFAULT 3
);

INSERT INTO children_new (id, created_at, year_group, daily_session_limit)
  SELECT id, created_at, year_group, daily_session_limit FROM children;

DROP TABLE children;
ALTER TABLE children_new RENAME TO children;

-- The curriculum's 75 skills and their 84 prerequisite edges. Kept as its own
-- table rather than folded into `skills`, because one taught skill may be built
-- from several curriculum skills and the graph is about the curriculum, not
-- about what this app happens to teach yet.
CREATE TABLE IF NOT EXISTS curriculum_skills (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  year_group TEXT NOT NULL
    CHECK (year_group IN ('reception', 'year2', 'year3')),
  domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  learning_objective TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  teaching_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curriculum_prerequisites (
  skill_id TEXT NOT NULL REFERENCES curriculum_skills(id) ON DELETE CASCADE,
  requires_id TEXT NOT NULL REFERENCES curriculum_skills(id) ON DELETE CASCADE,
  PRIMARY KEY (skill_id, requires_id)
);

-- Which curriculum skills a taught skill was built from.
CREATE TABLE IF NOT EXISTS skill_curriculum_map (
  skill_id TEXT NOT NULL,
  curriculum_skill_id TEXT NOT NULL,
  PRIMARY KEY (skill_id, curriculum_skill_id)
);

CREATE INDEX IF NOT EXISTS idx_skills_year_group ON skills (year_group, enabled);
CREATE INDEX IF NOT EXISTS idx_curriculum_year ON curriculum_skills (year_group, teaching_order);
