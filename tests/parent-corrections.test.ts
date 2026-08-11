import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { loadConfig } from '../server/config';
import { createDatabase } from '../server/database';
import { ParentService } from '../server/parent-service';
import { TutoringService } from '../server/tutoring-service';

/**
 * Day 21. A correction has to change mastery immediately, keep the child's own
 * result intact, and be reversible back to exactly the state that existed
 * before it — otherwise an adult cannot safely touch the record at all.
 */
describe('parent corrections', () => {
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

  /** Answers `count` questions, using the key or a deliberate wrong answer. */
  function practise(childId: string, results: boolean[]): string[] {
    const started = tutor.startSession({ childId });
    assert.ok(started.sessionId && started.question);
    let questionId: string | null = started.question.id;
    const attemptIds: string[] = [];

    for (const correct of results) {
      assert.ok(questionId, 'ran out of questions');
      const outcome = tutor.submitAnswer({
        sessionId: started.sessionId,
        questionId,
        answer: correct ? answerKeyFor(questionId) : 'not-the-answer',
      });
      attemptIds.push(
        (
          database
            .prepare(
              'SELECT id FROM attempts WHERE session_id = ? AND template_id = ?',
            )
            .get(started.sessionId, questionId) as { id: string }
        ).id,
      );
      questionId = outcome.nextQuestion?.id ?? null;
    }
    return attemptIds;
  }

  it('recalculates mastery from the corrected result', () => {
    const [attemptId] = practise('child-correct', [false]);

    const before = parent.getOverview('child-correct') as {
      mastery: Array<{ score: number }>;
    };
    assert.equal(before.mastery[0].score, 0);

    const result = parent.correctAttempt(attemptId, {
      isCorrect: true,
      reason: 'She said the right number, I mistyped it for her',
    });

    assert.equal(result.originalIsCorrect, false);
    assert.equal(result.correctedIsCorrect, true);
    assert.equal(result.mastery.correctAttempts, 1);
    assert.equal(result.mastery.score, 1);
  });

  it('never overwrites the result the child actually produced', () => {
    const [attemptId] = practise('child-audit', [false]);

    parent.correctAttempt(attemptId, {
      isCorrect: true,
      reason: 'Marked wrong by mistake',
    });

    const attempt = database
      .prepare(
        'SELECT is_correct, corrected_is_correct FROM attempts WHERE id = ?',
      )
      .get(attemptId) as { is_correct: number; corrected_is_correct: number };
    assert.equal(attempt.is_correct, 0, 'the original result is untouched');
    assert.equal(attempt.corrected_is_correct, 1);
  });

  it('keeps an append-only audit trail through correction and reversal', () => {
    const [attemptId] = practise('child-trail', [false]);

    parent.correctAttempt(attemptId, { isCorrect: true, reason: 'First look' });
    parent.reverseCorrection(attemptId);

    const trail = database
      .prepare(
        `SELECT action, original_is_correct, corrected_is_correct, reason
         FROM attempt_corrections WHERE attempt_id = ?
         ORDER BY created_at, rowid`,
      )
      .all(attemptId);

    assert.equal(trail.length, 2, 'the reversal adds a row rather than editing');
    assert.deepEqual(trail[0], {
      action: 'applied',
      original_is_correct: 0,
      corrected_is_correct: 1,
      reason: 'First look',
    });
    assert.deepEqual(trail[1], {
      action: 'reversed',
      original_is_correct: 0,
      corrected_is_correct: null,
      reason: 'Correction withdrawn by an adult',
    });
  });

  it('restores mastery exactly when a correction is reversed', () => {
    // Five correct answers promote to secure; correcting the last one down
    // must not leave the child stuck at learning after the reversal.
    const attempts = practise('child-reversal', [true, true, true, true, true]);
    const before = parent.getOverview('child-reversal') as {
      mastery: Array<Record<string, unknown>>;
    };
    assert.equal(before.mastery[0].level, 'secure');

    const corrected = parent.correctAttempt(attempts[4], {
      isCorrect: false,
      reason: 'I answered that one for him',
    });
    assert.equal(corrected.mastery.level, 'learning');
    assert.equal(corrected.mastery.correctAttempts, 4);
    const correctedBeforeReversal = corrected.mastery;

    // Captured from the same surface as the comparison, so the review schedule
    // is included: it is derived from the evidence, so a reversal that restored
    // the level but not the schedule would still have left the two disagreeing.
    const beforeReview = correctedBeforeReversal.nextReviewAt;
    const reversed = parent.reverseCorrection(attempts[4]);

    assert.deepEqual(
      {
        skillId: reversed.mastery.skillId,
        level: reversed.mastery.level,
        correctAttempts: reversed.mastery.correctAttempts,
        totalAttempts: reversed.mastery.totalAttempts,
        score: reversed.mastery.score,
      },
      {
        skillId: before.mastery[0].skillId,
        level: before.mastery[0].level,
        correctAttempts: before.mastery[0].correctAttempts,
        totalAttempts: before.mastery[0].totalAttempts,
        score: before.mastery[0].score,
      },
      'reversal restores the exact mastery that existed before the correction',
    );

    // Five correct answers again means the longest interval, not the one-day
    // interval the correction had dropped it to.
    assert.notEqual(
      reversed.mastery.nextReviewAt,
      beforeReview,
      'the review schedule must follow the restored evidence',
    );
  });

  it('refuses a correction without a reason, and a reversal with nothing to reverse', () => {
    const [attemptId] = practise('child-refusals', [true]);

    assert.throws(
      () => parent.correctAttempt(attemptId, { isCorrect: false, reason: '  ' }),
      /reason is required/i,
    );
    assert.throws(
      () => parent.reverseCorrection(attemptId),
      /no correction to reverse/i,
    );
    assert.throws(
      () => parent.correctAttempt('no-such-attempt', {
        isCorrect: true,
        reason: 'x',
      }),
      /attempt not found/i,
    );
  });

  it('refuses to correct a skipped attempt, which was never graded', () => {
    const started = tutor.startSession({ childId: 'child-skip-correct' });
    assert.ok(started.sessionId && started.question);
    tutor.skipQuestion({
      sessionId: started.sessionId,
      questionId: started.question.id,
    });
    const { id } = database
      .prepare("SELECT id FROM attempts WHERE outcome = 'skipped'")
      .get() as { id: string };

    assert.throws(
      () => parent.correctAttempt(id, { isCorrect: true, reason: 'try' }),
      /only an answered attempt/i,
    );
  });
});
