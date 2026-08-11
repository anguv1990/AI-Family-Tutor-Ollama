import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';

/**
 * "There is nothing to practise" and "that is enough for today" are states a
 * child reaches by using the app as intended — a child who worked through a
 * skill yesterday meets the first one every morning. Neither may surface as an
 * error, because the UI would have to render a failure to a four-year-old who
 * has done nothing wrong.
 */
describe('session availability', () => {
  const morning = new Date('2026-08-11T09:00:00Z');
  let database: Database.Database;
  let clock: { current: Date };
  let tutor: TutoringService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    clock = { current: morning };
    tutor = new TutoringService(database, { now: () => clock.current });
    tutor.seedInitialContent();
  });

  afterEach(() => database.close());

  it('reports an exhausted bank as a state rather than throwing', () => {
    // Everything reviewed is switched off, so the selector has nothing at all.
    database.prepare('UPDATE content_templates SET enabled = 0').run();

    const result = tutor.startSession({ childId: 'child-nothing' });

    assert.equal(result.status, 'exhausted');
    assert.equal(result.sessionId, null);
    assert.equal(result.question, null);
    assert.ok(result.message && result.message.length > 0);
    assert.equal(result.mastery.level, 'new');
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS total FROM sessions')
        .get()!['total' as never],
      0,
      'no empty session is left behind',
    );
  });

  it('reports the 24-hour re-ask window as exhausted, not as a failure', () => {
    // Yesterday the child answered every question in the skill. Today the
    // whole bank is still inside its re-ask window.
    const skillId = 'reception.counting-to-10';
    // A raised cap, so this test fails on the re-ask window and nothing else.
    database
      .prepare(
        `INSERT INTO children (id, daily_session_limit)
         VALUES ('child-yesterday', 5)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO sessions (id, child_id, skill_id, started_at, ended_at,
                               ended_reason)
         VALUES ('yesterday', 'child-yesterday', ?, ?, ?, 'completed')`,
      )
      .run(skillId, '2026-08-11 08:00:00', '2026-08-11 08:20:00');
    const templates = database
      .prepare(
        `SELECT id, version FROM content_templates
         WHERE skill_id = ? AND reviewed = 1 AND enabled = 1`,
      )
      .all(skillId) as Array<{ id: string; version: number }>;
    const insert = database.prepare(
      `INSERT INTO attempts
         (id, session_id, child_id, template_id, template_version, answer,
          is_correct, created_at)
       VALUES (?, 'yesterday', 'child-yesterday', ?, ?, '1', 1, ?)`,
    );
    for (const template of templates) {
      insert.run(`y-${template.id}`, template.id, template.version, '2026-08-11 08:10:00');
    }

    clock.current = new Date('2026-08-11T09:00:00Z');
    const blocked = tutor.startSession({ childId: 'child-yesterday', skillId });
    assert.equal(blocked.status, 'exhausted', 'inside the 24-hour window');

    // A day later the same bank is available again.
    clock.current = new Date('2026-08-12T09:00:00Z');
    const later = tutor.startSession({ childId: 'child-yesterday', skillId });
    assert.equal(later.status, 'active');
    assert.ok(later.question);
  });

  it('caps a child at one new session a day and says when the next one is', () => {
    const first = tutor.startSession({ childId: 'child-capped' });
    assert.equal(first.status, 'active');
    assert.ok(first.sessionId);
    tutor.completeSession({ sessionId: first.sessionId });

    const second = tutor.startSession({ childId: 'child-capped' });

    assert.equal(second.status, 'daily_limit');
    assert.equal(second.sessionId, null);
    assert.equal(second.question, null);
    assert.ok(second.message && second.message.length > 0);
    assert.ok(
      second.nextAvailableAt && Date.parse(second.nextAvailableAt) > clock.current.getTime(),
      'the child is told when they can practise again',
    );
  });

  it('lets the child resume the day session they are already in', () => {
    const first = tutor.startSession({ childId: 'child-resume-capped' });

    const resumed = tutor.startSession({ childId: 'child-resume-capped' });

    assert.equal(resumed.status, 'active', 'the cap limits new sessions only');
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.sessionId, first.sessionId);
  });

  it('lifts the cap when the local day rolls over', () => {
    const first = tutor.startSession({ childId: 'child-tomorrow' });
    assert.ok(first.sessionId);
    tutor.completeSession({ sessionId: first.sessionId });
    assert.equal(
      tutor.startSession({ childId: 'child-tomorrow' }).status,
      'daily_limit',
    );

    clock.current = new Date(morning.getTime() + 24 * 60 * 60 * 1000);

    const tomorrow = tutor.startSession({ childId: 'child-tomorrow' });
    assert.equal(tomorrow.status, 'active');
    assert.equal(tomorrow.resumed, false);
  });

  it('honours a parent-raised limit', () => {
    database
      .prepare(
        `INSERT INTO children (id, daily_session_limit) VALUES ('child-extra', 3)`,
      )
      .run();

    for (let session = 0; session < 3; session += 1) {
      const started = tutor.startSession({ childId: 'child-extra' });
      assert.equal(started.status, 'active', `session ${session + 1}`);
      assert.ok(started.sessionId);
      tutor.completeSession({ sessionId: started.sessionId });
    }

    assert.equal(
      tutor.startSession({ childId: 'child-extra' }).status,
      'daily_limit',
      'the raised limit is still a limit',
    );
  });

  it('blocks every session when a parent sets the limit to zero', () => {
    database
      .prepare(
        `INSERT INTO children (id, daily_session_limit) VALUES ('child-paused', 0)`,
      )
      .run();

    assert.equal(
      tutor.startSession({ childId: 'child-paused' }).status,
      'daily_limit',
    );
  });
});
