import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';

describe('Reception Maths tutoring vertical slice', () => {
  let database: Database.Database;
  let tutor: TutoringService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    tutor = new TutoringService(database);
    tutor.seedInitialContent();
  });

  afterEach(() => database.close());

  it('starts a session with a reviewed question and does not expose its answer', () => {
    const session = tutor.startSession({ childId: 'child-1' });

    assert.equal(session.childId, 'child-1');
    assert.equal(session.question.skillId, 'reception.addition-within-5');
    assert.equal(session.question.prompt, 'What is 1 + 1?');
    assert.equal('correctAnswer' in session.question, false);
  });

  it('marks an answer, persists the attempt, updates mastery, and selects the next question', () => {
    const session = tutor.startSession({ childId: 'child-1' });

    const result = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: ' 2 ',
    });

    assert.equal(result.correct, true);
    assert.deepEqual(result.mastery, {
      skillId: 'reception.addition-within-5',
      level: 'learning',
      correctAttempts: 1,
      totalAttempts: 1,
      score: 1,
    });
    assert.ok(result.nextQuestion);
    assert.notEqual(result.nextQuestion.id, session.question.id);
    assert.equal(result.nextQuestion.difficulty, 2);

    const attempt = database
      .prepare('SELECT answer, is_correct FROM attempts WHERE session_id = ?')
      .get(session.sessionId) as { answer: string; is_correct: number };
    assert.deepEqual(attempt, { answer: '2', is_correct: 1 });
  });

  it('records an incorrect answer and does not award mastery credit', () => {
    const session = tutor.startSession({ childId: 'child-2' });

    const result = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: '3',
    });

    assert.equal(result.correct, false);
    assert.equal(result.mastery.correctAttempts, 0);
    assert.equal(result.mastery.totalAttempts, 1);
    assert.equal(result.mastery.score, 0);
  });

  it('rejects a duplicate answer without changing mastery twice', () => {
    const session = tutor.startSession({ childId: 'child-3' });
    const submission = {
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: '2',
    };

    tutor.submitAnswer(submission);
    assert.throws(() => tutor.submitAnswer(submission), /already been answered/i);

    const mastery = database
      .prepare('SELECT correct_attempts, total_attempts FROM mastery WHERE child_id = ?')
      .get('child-3') as { correct_attempts: number; total_attempts: number };
    assert.deepEqual(mastery, { correct_attempts: 1, total_attempts: 1 });
  });

  it('records a skip without changing graded mastery evidence', () => {
    const session = tutor.startSession({ childId: 'child-skip' });

    const result = tutor.skipQuestion({
      sessionId: session.sessionId,
      questionId: session.question.id,
    });

    assert.deepEqual(result.mastery, {
      skillId: 'reception.addition-within-5',
      level: 'new',
      correctAttempts: 0,
      totalAttempts: 0,
      score: 0,
    });
    assert.ok(result.nextQuestion);
    assert.equal(result.nextQuestion.difficulty, 1);

    const attempt = database
      .prepare('SELECT outcome FROM attempts WHERE session_id = ?')
      .get(session.sessionId) as { outcome: string };
    assert.equal(attempt.outcome, 'skipped');
  });

  it('promotes to secure and selects difficulty 3 after sufficient evidence', () => {
    let session = tutor.startSession({ childId: 'child-progress' });
    const answers: Record<string, string> = {
      'addition-1-plus-1': '2',
      'addition-2-plus-1': '3',
      'addition-2-plus-2': '4',
      'addition-3-plus-1': '4',
      'addition-3-plus-2': '5',
    };

    let latest;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      latest = tutor.submitAnswer({
        sessionId: session.sessionId,
        questionId: session.question.id,
        answer: answers[session.question.id],
      });
      assert.ok(latest.nextQuestion);
      session = { ...session, question: latest.nextQuestion };
    }

    assert.equal(latest?.mastery.level, 'secure');
    assert.equal(latest?.nextQuestion?.difficulty, 3);
  });
});
