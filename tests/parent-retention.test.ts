import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { loadConfig } from '../server/config';
import { createDatabase } from '../server/database';
import { ParentService } from '../server/parent-service';
import { TutoringService } from '../server/tutoring-service';

/**
 * Day 24. Retention deletes real records, so every test here pins the clock and
 * checks the boundary from both sides: what is expired goes, what is not stays,
 * and an unconfigured retention period removes nothing at all.
 */
describe('retention and privacy controls', () => {
  const today = new Date('2026-08-11T09:00:00Z');
  let database: Database.Database;
  let clock: { current: Date };
  let tutor: TutoringService;
  let parent: ParentService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    clock = { current: today };
    tutor = new TutoringService(database, { now: () => clock.current });
    tutor.seedInitialContent();
    parent = new ParentService(
      database,
      tutor,
      loadConfig({ HOST: '127.0.0.1' }),
      { now: () => clock.current },
    );
    database.prepare("INSERT INTO children (id) VALUES ('child-r')").run();
  });

  afterEach(() => database.close());

  /** Writes a finished session directly, so its age is exact. */
  function endedSession(
    id: string,
    endedAt: string,
    options: { answers?: number; event?: boolean } = {},
  ): void {
    database
      .prepare(
        `INSERT INTO sessions (id, child_id, skill_id, started_at, ended_at,
                               ended_reason)
         VALUES (?, 'child-r', 'reception.addition-within-5', ?, ?, 'completed')`,
      )
      .run(id, endedAt, endedAt);

    const templates = database
      .prepare(
        `SELECT id, version, correct_answer FROM content_templates
         WHERE skill_id = 'reception.addition-within-5'
         ORDER BY sequence LIMIT ?`,
      )
      .all(options.answers ?? 0) as Array<{
      id: string;
      version: number;
      correct_answer: string;
    }>;
    for (const [index, template] of templates.entries()) {
      database
        .prepare(
          `INSERT INTO attempts
             (id, session_id, child_id, template_id, template_version, answer,
              is_correct, created_at)
           VALUES (?, ?, 'child-r', ?, ?, ?, 1, ?)`,
        )
        .run(
          `${id}-attempt-${index}`,
          id,
          template.id,
          template.version,
          template.correct_answer,
          endedAt,
        );
    }

    if (options.event) {
      database
        .prepare(
          `INSERT INTO safety_events (id, session_id, event_type, created_at)
           VALUES (?, ?, 'fallback_used', ?)`,
        )
        .run(`${id}-event`, id, endedAt);
    }
  }

  const count = (sql: string): number =>
    (database.prepare(sql).get() as { total: number }).total;

  it('keeps everything until a parent sets a retention period', () => {
    endedSession('old', '2020-01-01 09:00:00', { answers: 1, event: true });

    const result = parent.runRetention();

    assert.deepEqual(result.removed, {
      sessions: 0,
      attempts: 0,
      corrections: 0,
      safetyEvents: 0,
    });
    assert.equal(count('SELECT COUNT(*) AS total FROM sessions'), 1);
    assert.equal(
      parent.getRetention().lastRunAt,
      today.toISOString(),
      'the run is still recorded so a parent can see it happened',
    );
  });

  it('removes only sessions that ended before the cutoff', () => {
    parent.updateRetention({ sessionDays: 30, eventDays: 0 });
    // 30 days before 2026-08-11T09:00 is 2026-07-12T09:00.
    endedSession('expired', '2026-07-12 08:59:59', { answers: 1, event: true });
    endedSession('on-the-boundary', '2026-07-12 09:00:00', { answers: 1 });
    endedSession('recent', '2026-08-10 09:00:00', { answers: 1 });
    database
      .prepare(
        `INSERT INTO sessions (id, child_id, skill_id, started_at)
         VALUES ('still-open', 'child-r', 'reception.addition-within-5', ?)`,
      )
      .run('2020-01-01 09:00:00');

    const result = parent.runRetention();

    assert.equal(result.removed.sessions, 1);
    assert.equal(result.removed.attempts, 1);
    assert.equal(result.removed.safetyEvents, 1);
    assert.deepEqual(
      (
        database
          .prepare('SELECT id FROM sessions ORDER BY id')
          .all() as Array<{ id: string }>
      ).map((row) => row.id),
      ['on-the-boundary', 'recent', 'still-open'],
      'the boundary is kept, and an unfinished session is never expired',
    );
  });

  it('removes only safety events older than the event period', () => {
    parent.updateRetention({ sessionDays: 0, eventDays: 7 });
    endedSession('kept', '2026-08-10 09:00:00', { answers: 1, event: true });
    database
      .prepare(
        `INSERT INTO safety_events (id, session_id, event_type, created_at)
         VALUES ('ancient', 'kept', 'schema_rejected', '2026-08-01 09:00:00')`,
      )
      .run();

    const result = parent.runRetention();

    assert.equal(result.removed.safetyEvents, 1);
    assert.equal(result.removed.sessions, 0, 'sessions are a separate period');
    assert.deepEqual(
      (
        database
          .prepare('SELECT id FROM safety_events')
          .all() as Array<{ id: string }>
      ).map((row) => row.id),
      ['kept-event'],
    );
  });

  it('recalculates mastery so it never claims evidence that was pruned', () => {
    parent.updateRetention({ sessionDays: 30, eventDays: 0 });
    endedSession('gone', '2026-07-01 09:00:00', { answers: 4 });
    endedSession('stays', '2026-08-10 09:00:00', { answers: 0 });
    tutor.recalculateMastery('child-r', 'reception.addition-within-5');
    assert.equal(
      (
        database
          .prepare(
            'SELECT total_attempts AS total FROM mastery WHERE child_id = ?',
          )
          .get('child-r') as { total: number }
      ).total,
      4,
    );

    parent.runRetention();

    assert.equal(
      (
        database
          .prepare(
            'SELECT total_attempts AS total FROM mastery WHERE child_id = ?',
          )
          .get('child-r') as { total: number }
      ).total,
      0,
      'mastery follows the evidence that is still stored',
    );
  });

  it('rejects a retention period that is not a whole number of days', () => {
    assert.throws(
      () => parent.updateRetention({ sessionDays: -1, eventDays: 0 }),
      /whole number/i,
    );
    assert.throws(
      () => parent.updateRetention({ sessionDays: 1.5, eventDays: 0 }),
      /whole number/i,
    );
    assert.deepEqual(parent.getRetention(), {
      sessionDays: 0,
      eventDays: 0,
      lastRunAt: null,
    });
  });

  it('clears the cache without touching learning records', () => {
    endedSession('kept', '2026-08-10 09:00:00', { answers: 2 });
    database
      .prepare("INSERT INTO cache (hash, output) VALUES ('a', 'x'), ('b', 'y')")
      .run();

    assert.deepEqual(parent.clearCache(), { cleared: 2 });
    assert.equal(count('SELECT COUNT(*) AS total FROM cache'), 0);
    assert.equal(count('SELECT COUNT(*) AS total FROM attempts'), 2);
  });

  it('summarises what is stored, what is not, and how it is reached', () => {
    endedSession('kept', '2026-08-10 09:00:00', { answers: 1, event: true });

    const summary = parent.getPrivacySummary() as Record<string, any>;

    assert.equal(summary.network.lanMode, false);
    assert.equal(summary.parentAccess.mode, 'open-loopback');
    assert.match(summary.parentAccess.detail, /ADMIN_SECRET/);
    assert.match(JSON.stringify(summary.notStored), /[Aa]udio/);
    assert.equal(summary.counts.children, 1);
    assert.equal(summary.counts.attempts, 1);
    assert.equal(summary.counts.safetyEvents, 1);
    assert.deepEqual(summary.retention, {
      sessionDays: 0,
      eventDays: 0,
      lastRunAt: null,
    });
    assert.doesNotMatch(
      JSON.stringify(summary),
      /adminSecret|ADMIN_SECRET":/,
      'the summary never carries the secret itself',
    );
  });
});
