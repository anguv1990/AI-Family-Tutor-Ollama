import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { CacheEntry, CacheStore, SafetyEvent, SafetyEventSink } from './ai';

/**
 * SQLite implementations of the two ports `server/ai/` defines but deliberately
 * does not implement. The AI slice opens no database of its own; this file is
 * the only place where its ports meet the family database.
 */

export class SqliteCacheStore implements CacheStore {
  constructor(private readonly database: Database.Database) {}

  get(key: string): CacheEntry | undefined {
    const row = this.database
      .prepare('SELECT output, created_at FROM cache WHERE hash = ?')
      .get(key) as { output: string; created_at: string } | undefined;
    if (!row) return undefined;
    return { value: row.output, createdAt: Date.parse(`${row.created_at}Z`) };
  }

  set(key: string, entry: CacheEntry): void {
    this.database
      .prepare(
        `INSERT INTO cache (hash, output, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT (hash) DO UPDATE SET
           output = excluded.output,
           created_at = excluded.created_at`,
      )
      .run(key, entry.value, new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 19));
  }

  /** Parent-facing cache clearing, per the privacy controls in plan.md. */
  clear(): number {
    return this.database.prepare('DELETE FROM cache').run().changes;
  }
}

export class SqliteSafetyEventSink implements SafetyEventSink {
  constructor(private readonly database: Database.Database) {}

  record(event: SafetyEvent): void {
    // A failure to record must never break the child's session — the hint has
    // already been made safe by this point, and losing an audit row is a
    // smaller harm than a crash mid-question. It is still surfaced to stderr.
    try {
      this.database
        .prepare(
          `INSERT INTO safety_events
             (id, session_id, event_type, task, prompt_version, provider,
              model, reason, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          event.sessionId ?? null,
          event.type,
          event.task,
          event.promptVersion,
          event.provider,
          event.model,
          event.reason,
          event.detail ?? null,
          new Date(event.createdAt).toISOString().replace('T', ' ').slice(0, 19),
        );
    } catch (error) {
      console.error(
        'safety event not recorded:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
}
