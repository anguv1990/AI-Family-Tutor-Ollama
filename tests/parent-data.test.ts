import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { loadConfig } from '../server/config';
import { createDatabase } from '../server/database';
import { ParentService } from '../server/parent-service';
import { TutoringService } from '../server/tutoring-service';

/**
 * Days 22 and 23: export and permanent deletion, and the multi-child isolation
 * that MVP acceptance criterion 5 turns on.
 */
describe('parent export and deletion', () => {
  const now = new Date('2026-08-11T09:00:00Z');
  let database: Database.Database;
  let tutor: TutoringService;
  let parent: ParentService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    tutor = new TutoringService(database, { now: () => now });
    tutor.seedInitialContent();
    parent = new ParentService(
      database,
      tutor,
      loadConfig({ HOST: '127.0.0.1' }),
      { now: () => now },
    );
  });

  afterEach(() => database.close());

  const answerKeyFor = (templateId: string): string =>
    (
      database
        .prepare('SELECT correct_answer FROM content_templates WHERE id = ?')
        .get(templateId) as { correct_answer: string }
    ).correct_answer;

  /** One session: two answers, one skip, one safety event, one correction. */
  function fullHistoryFor(childId: string): {
    sessionId: string;
    attemptIds: string[];
  } {
    const started = tutor.startSession({ childId });
    assert.ok(started.sessionId && started.question);
    const sessionId = started.sessionId;

    let questionId: string | null = started.question.id;
    for (let index = 0; index < 2; index += 1) {
      assert.ok(questionId);
      const outcome = tutor.submitAnswer({
        sessionId,
        questionId,
        answer: index === 0 ? answerKeyFor(questionId) : 'wrong',
      });
      questionId = outcome.nextQuestion?.id ?? null;
    }
    assert.ok(questionId);
    tutor.skipQuestion({ sessionId, questionId });

    database
      .prepare(
        `INSERT INTO safety_events (id, session_id, event_type, reason)
         VALUES (?, ?, 'schema_rejected', 'invalid_json')`,
      )
      .run(`event-${childId}`, sessionId);

    const attemptIds = (
      database
        .prepare(
          `SELECT id FROM attempts WHERE child_id = ? AND outcome = 'answered'
           ORDER BY created_at, rowid`,
        )
        .all(childId) as Array<{ id: string }>
    ).map((row) => row.id);

    parent.correctAttempt(attemptIds[1], {
      isCorrect: true,
      reason: 'He said four and I typed it wrongly',
    });

    return { sessionId, attemptIds };
  }

  it('exports everything stored about one child and nothing else', () => {
    fullHistoryFor('child-export');
    fullHistoryFor('child-other');
    database
      .prepare("INSERT INTO cache (hash, output) VALUES ('h1', 'cached hint')")
      .run();

    const exported = parent.exportChild('child-export') as Record<string, any>;

    assert.equal(exported.format, 'ai-family-tutor.child-export');
    assert.equal(exported.formatVersion, 1);
    assert.equal(exported.exportedAt, now.toISOString());
    assert.equal(exported.child.childId, 'child-export');
    assert.equal(exported.sessions.length, 1);
    assert.equal(exported.attempts.length, 3, 'two answers and one skip');
    assert.equal(exported.mastery.length, 1);
    assert.equal(exported.corrections.length, 1);
    assert.equal(exported.safetyEvents.length, 1);

    const serialised = JSON.stringify(exported);
    assert.doesNotMatch(serialised, /child-other/, 'no other child appears');
    assert.doesNotMatch(serialised, /cached hint/, 'cache contents excluded');
    assert.doesNotMatch(
      serialised,
      /correctAnswer|correct_answer/,
      'answer keys stay in the reviewed bank',
    );
  });

  it('exports contents that match the database', () => {
    const { attemptIds } = fullHistoryFor('child-match');

    const exported = parent.exportChild('child-match') as Record<string, any>;

    const stored = database
      .prepare(
        `SELECT COUNT(*) AS attempts,
                (SELECT COUNT(*) FROM sessions WHERE child_id = 'child-match') AS sessions,
                (SELECT COUNT(*) FROM attempt_corrections WHERE child_id = 'child-match') AS corrections
         FROM attempts WHERE child_id = 'child-match'`,
      )
      .get() as { attempts: number; sessions: number; corrections: number };

    assert.equal(exported.attempts.length, stored.attempts);
    assert.equal(exported.sessions.length, stored.sessions);
    assert.equal(exported.corrections.length, stored.corrections);

    const corrected = exported.attempts.find(
      (attempt: { attemptId: string }) => attempt.attemptId === attemptIds[1],
    );
    assert.equal(corrected.recordedCorrect, false, 'what the child scored');
    assert.equal(corrected.effectiveCorrect, true, 'what counts now');
    assert.equal(corrected.corrected, true);
  });

  it('permanently deletes one child and leaves shared content in place', () => {
    fullHistoryFor('child-delete');
    const templatesBefore = database
      .prepare('SELECT COUNT(*) AS total FROM content_templates')
      .get() as { total: number };
    database
      .prepare("INSERT INTO cache (hash, output) VALUES ('shared', 'wording')")
      .run();

    const result = parent.deleteChild('child-delete', 'child-delete');

    assert.equal(result.deleted.child, 1);
    assert.equal(result.deleted.sessions, 1);
    assert.equal(result.deleted.attempts, 3);
    assert.equal(result.deleted.corrections, 1);
    assert.equal(result.deleted.mastery, 1);
    assert.equal(result.deleted.safetyEvents, 1);

    for (const table of [
      'sessions',
      'attempts',
      'attempt_corrections',
      'mastery',
    ]) {
      const remaining = database
        .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE child_id = ?`)
        .get('child-delete') as { total: number };
      assert.equal(remaining.total, 0, `${table} still holds the child's rows`);
    }
    assert.equal(
      (
        database
          .prepare('SELECT COUNT(*) AS total FROM children WHERE id = ?')
          .get('child-delete') as { total: number }
      ).total,
      0,
    );
    assert.equal(
      (
        database
          .prepare('SELECT COUNT(*) AS total FROM safety_events')
          .get() as { total: number }
      ).total,
      0,
      "the child's safety events go with the sessions that raised them",
    );

    // Shared, non-personal records survive deliberately.
    assert.deepEqual(
      database.prepare('SELECT COUNT(*) AS total FROM content_templates').get(),
      templatesBefore,
      'the reviewed curriculum is not the child’s data',
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS total FROM cache').get() as {
          total: number;
        }
      ).total,
      1,
      'cached wording holds no child data and stays',
    );
  });

  it('requires the deletion to be confirmed with the child id', () => {
    fullHistoryFor('child-confirm');

    assert.throws(
      () => parent.deleteChild('child-confirm', 'yes'),
      /confirm must repeat/i,
    );
    assert.equal(
      (
        database
          .prepare('SELECT COUNT(*) AS total FROM children WHERE id = ?')
          .get('child-confirm') as { total: number }
      ).total,
      1,
      'an unconfirmed deletion changes nothing',
    );
  });

  it('keeps one child’s session, export and deletion away from another’s', () => {
    const kept = fullHistoryFor('child-kept');
    const removed = fullHistoryFor('child-removed');

    const keptExport = parent.exportChild('child-kept') as Record<string, any>;
    assert.equal(keptExport.sessions[0].sessionId, kept.sessionId);
    assert.notEqual(keptExport.sessions[0].sessionId, removed.sessionId);
    assert.deepEqual(
      keptExport.attempts
        .map((attempt: { attemptId: string }) => attempt.attemptId)
        .sort(),
      (
        database
          .prepare('SELECT id FROM attempts WHERE child_id = ? ORDER BY id')
          .all('child-kept') as Array<{ id: string }>
      )
        .map((row) => row.id)
        .sort(),
      'the export reads only this child’s attempts',
    );

    const before = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM sessions WHERE child_id = 'child-kept') AS sessions,
           (SELECT COUNT(*) FROM attempts WHERE child_id = 'child-kept') AS attempts,
           (SELECT COUNT(*) FROM mastery WHERE child_id = 'child-kept') AS mastery,
           (SELECT COUNT(*) FROM attempt_corrections WHERE child_id = 'child-kept') AS corrections,
           (SELECT COUNT(*) FROM safety_events WHERE session_id = ?) AS events`,
      )
      .get(kept.sessionId);

    parent.deleteChild('child-removed', 'child-removed');

    const after = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM sessions WHERE child_id = 'child-kept') AS sessions,
           (SELECT COUNT(*) FROM attempts WHERE child_id = 'child-kept') AS attempts,
           (SELECT COUNT(*) FROM mastery WHERE child_id = 'child-kept') AS mastery,
           (SELECT COUNT(*) FROM attempt_corrections WHERE child_id = 'child-kept') AS corrections,
           (SELECT COUNT(*) FROM safety_events WHERE session_id = ?) AS events`,
      )
      .get(kept.sessionId);

    assert.deepEqual(after, before, 'the other child is untouched');
    assert.deepEqual(
      parent.exportChild('child-kept'),
      { ...keptExport },
      'and exports identically after the deletion',
    );
    assert.throws(
      () => parent.exportChild('child-removed'),
      /child not found/i,
    );
  });

  it('refuses to read or delete a child that does not exist', () => {
    assert.throws(() => parent.getOverview('nobody'), /child not found/i);
    assert.throws(() => parent.exportChild('nobody'), /child not found/i);
    assert.throws(() => parent.deleteChild('nobody', 'nobody'), /child not found/i);
  });
});
