import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

type Migration = {
  version: number;
  filename: string;
  /**
   * Set when the migration rebuilds a table other tables point at. SQLite only
   * lets foreign key enforcement be switched off outside a transaction, and
   * without switching it off the DROP TABLE half of a rebuild cascades the
   * parent's children away. The check afterwards proves nothing was left
   * dangling, so the relaxation cannot hide a broken migration.
   */
  rebuildsTable?: boolean;
};

/** The ordered migration set; exported so tests assert against one source. */
export const migrations: Migration[] = [
  { version: 1, filename: 'create_tables.sql' },
  { version: 2, filename: '002_mastery_levels.sql' },
  { version: 3, filename: '003_session_completion.sql' },
  { version: 4, filename: '004_content_provenance.sql' },
  { version: 5, filename: '005_session_limits.sql', rebuildsTable: true },
  { version: 6, filename: '006_safety_event_detail.sql' },
  { version: 7, filename: '007_parent_controls.sql' },
  { version: 8, filename: '008_year_groups.sql' },
  { version: 9, filename: '009_daily_limit_default.sql' },
  { version: 10, filename: '010_question_visuals.sql' },
];

export function createDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const migration of migrations) {
    const applied = database
      .prepare('SELECT 1 FROM schema_versions WHERE version = ?')
      .get(migration.version);
    if (applied) continue;

    const migrationPath = path.resolve(
      process.cwd(),
      'db/migrations',
      migration.filename,
    );
    if (migration.rebuildsTable) database.pragma('foreign_keys = OFF');
    try {
      database.transaction(() => {
        database.exec(fs.readFileSync(migrationPath, 'utf8'));
        database
          .prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)')
          .run(migration.version);
      })();

      if (migration.rebuildsTable) {
        const violations = database.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(
            `Migration ${migration.version} left ${violations.length} foreign key violations`,
          );
        }
      }
    } finally {
      if (migration.rebuildsTable) database.pragma('foreign_keys = ON');
    }
  }

  return database;
}
