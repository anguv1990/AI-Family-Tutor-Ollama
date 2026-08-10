CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  curriculum_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS content_templates (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK (difficulty >= 1),
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  current_question_id TEXT REFERENCES content_templates(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES content_templates(id),
  template_version INTEGER NOT NULL,
  answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, template_id)
);

CREATE TABLE IF NOT EXISTS mastery (
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  correct_attempts INTEGER NOT NULL DEFAULT 0,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, skill_id)
);

CREATE TABLE IF NOT EXISTS cache (
  hash TEXT PRIMARY KEY,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS safety_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attempts_child_skill
  ON attempts (child_id, template_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sessions_child_started
  ON sessions (child_id, started_at);

INSERT OR IGNORE INTO schema_versions (version) VALUES (1);
