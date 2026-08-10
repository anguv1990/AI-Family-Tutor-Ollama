import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const migrations = [
  { version: 1, filename: 'create_tables.sql' },
  { version: 2, filename: '002_mastery_levels.sql' },
  { version: 3, filename: '003_session_completion.sql' },
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
    database.transaction(() => {
      database.exec(fs.readFileSync(migrationPath, 'utf8'));
      database
        .prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)')
        .run(migration.version);
    })();
  }

  return database;
}
