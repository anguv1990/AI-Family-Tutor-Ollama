import Database from 'better-sqlite3';
import crypto from 'crypto';

const DB_PATH = process.env.DB_PATH || './data/tutor.sqlite';
const db = new Database(DB_PATH);

export function promptHash(model: string, prompt: string, opts: any) {
  const key = `${model}|${JSON.stringify(opts)}|${prompt}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function getCached(hash: string) {
  const row = db.prepare('SELECT output FROM cache WHERE hash = ?').get(hash) as
    | { output: string }
    | undefined;
  return row ? JSON.parse(row.output) : null;
}

export function setCached(hash: string, output: any) {
  const stmt = db.prepare('INSERT OR REPLACE INTO cache (hash, output, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  stmt.run(hash, JSON.stringify(output));
}

export function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      hash TEXT PRIMARY KEY,
      output TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

ensureSchema();

export default db;
