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

  /**
   * Reads the answer key straight from the bank, so these tests exercise the
   * flow rather than hard-coding whichever questions the bank happens to serve.
   */
  const answerKeyFor = (templateId: string): string =>
    (
      database
        .prepare('SELECT correct_answer FROM content_templates WHERE id = ?')
        .get(templateId) as { correct_answer: string }
    ).correct_answer;

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

    let latest;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      latest = tutor.submitAnswer({
        sessionId: session.sessionId,
        questionId: session.question.id,
        answer: answerKeyFor(session.question.id),
      });
      assert.ok(latest.nextQuestion);
      session = { ...session, question: latest.nextQuestion };
    }

    assert.equal(latest?.mastery.level, 'secure');
    assert.equal(latest?.nextQuestion?.difficulty, 3);
  });

  it('resumes the active session instead of starting a second one', () => {
    const first = tutor.startSession({ childId: 'child-resume' });
    const second = tutor.startSession({ childId: 'child-resume' });

    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.resumed, true);
    assert.equal(second.question.id, first.question.id);

    const sessions = database
      .prepare('SELECT COUNT(*) AS total FROM sessions WHERE child_id = ?')
      .get('child-resume') as { total: number };
    assert.equal(sessions.total, 1);
  });

  it('resumes at the question the child had not yet answered', () => {
    const started = tutor.startSession({ childId: 'child-resume-progress' });
    const answered = tutor.submitAnswer({
      sessionId: started.sessionId,
      questionId: started.question.id,
      answer: '2',
    });

    const resumed = tutor.startSession({ childId: 'child-resume-progress' });

    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(resumed.question.id, answered.nextQuestion?.id);
    assert.deepEqual(resumed.mastery, answered.mastery);
  });

  it('completes a session explicitly and refuses further answers', () => {
    const session = tutor.startSession({ childId: 'child-complete' });

    const summary = tutor.completeSession({ sessionId: session.sessionId });

    assert.equal(summary.endedReason, 'completed');
    assert.equal(summary.questionsAnswered, 0);
    assert.throws(
      () =>
        tutor.submitAnswer({
          sessionId: session.sessionId,
          questionId: session.question.id,
          answer: '2',
        }),
      /active session not found/i,
    );
  });

  it('counts only graded answers in the completion summary', () => {
    const session = tutor.startSession({ childId: 'child-complete-count' });
    const answered = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: '2',
    });
    tutor.skipQuestion({
      sessionId: session.sessionId,
      questionId: answered.nextQuestion!.id,
    });

    const summary = tutor.completeSession({ sessionId: session.sessionId });

    assert.equal(summary.questionsAnswered, 1);
    assert.equal(summary.questionsSkipped, 1);
  });

  it('refuses to complete a session twice', () => {
    const session = tutor.startSession({ childId: 'child-complete-twice' });
    tutor.completeSession({ sessionId: session.sessionId });

    assert.throws(
      () => tutor.completeSession({ sessionId: session.sessionId }),
      /active session not found/i,
    );
  });

  it('starts a fresh session once the previous one was completed', () => {
    const first = tutor.startSession({ childId: 'child-second-session' });
    tutor.completeSession({ sessionId: first.sessionId });

    const second = tutor.startSession({ childId: 'child-second-session' });

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(second.resumed, false);
  });

  it('reports an exhausted session rather than ending silently', () => {
    const session = tutor.startSession({ childId: 'child-exhaust' });

    let questionId: string | undefined = session.question.id;
    let status = 'active';
    while (questionId) {
      const outcome = tutor.skipQuestion({
        sessionId: session.sessionId,
        questionId,
      });
      questionId = outcome.nextQuestion?.id;
      status = outcome.status;
    }

    assert.equal(status, 'exhausted');
    const stored = database
      .prepare('SELECT ended_reason FROM sessions WHERE id = ?')
      .get(session.sessionId) as { ended_reason: string };
    assert.equal(stored.ended_reason, 'exhausted');
  });

  it('starts a session on a chosen skill and never leaves it', () => {
    const session = tutor.startSession({
      childId: 'child-counting',
      skillId: 'reception.counting-to-10',
    });
    assert.equal(session.skillId, 'reception.counting-to-10');

    let question: { id: string; skillId: string } | null = session.question;
    let served = 0;
    while (question) {
      assert.equal(question.skillId, 'reception.counting-to-10');
      served += 1;
      question = tutor.skipQuestion({
        sessionId: session.sessionId,
        questionId: question.id,
      }).nextQuestion;
    }

    // The whole counting bank, and nothing from the other two skills.
    assert.equal(served, 21);
  });

  it('keeps mastery separate per skill', () => {
    const counting = tutor.startSession({
      childId: 'child-two-skills',
      skillId: 'reception.counting-to-10',
    });
    tutor.submitAnswer({
      sessionId: counting.sessionId,
      questionId: counting.question.id,
      answer: answerKeyFor(counting.question.id),
    });
    tutor.completeSession({ sessionId: counting.sessionId });

    const addition = tutor.startSession({
      childId: 'child-two-skills',
      skillId: 'reception.addition-within-5',
    });

    assert.equal(addition.mastery.skillId, 'reception.addition-within-5');
    assert.equal(addition.mastery.totalAttempts, 0);
    assert.equal(addition.mastery.level, 'new');
  });

  it('resumes the skill the session was started with, ignoring a new one', () => {
    const started = tutor.startSession({
      childId: 'child-skill-resume',
      skillId: 'reception.number-recognition',
    });

    const resumed = tutor.startSession({
      childId: 'child-skill-resume',
      skillId: 'reception.addition-within-5',
    });

    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(resumed.skillId, 'reception.number-recognition');
    assert.equal(resumed.question.id, started.question.id);
  });

  it('refuses an unknown or disabled skill', () => {
    assert.throws(
      () => tutor.startSession({ childId: 'child-bad-skill', skillId: 'nope' }),
      /skill not found/i,
    );

    database
      .prepare("UPDATE skills SET enabled = 0 WHERE id = 'reception.counting-to-10'")
      .run();
    assert.throws(
      () =>
        tutor.startSession({
          childId: 'child-off-skill',
          skillId: 'reception.counting-to-10',
        }),
      /skill not found/i,
    );
  });

  it('lists the enabled skills with their reviewed question counts', () => {
    const skills = tutor.listSkills();

    assert.equal(skills.length, 3);
    for (const skill of skills) {
      assert.ok(skill.title.trim());
      assert.ok(skill.questionCount >= 20, `${skill.id}: ${skill.questionCount}`);
    }
  });

  it('reads back the current state of an active session', () => {
    const session = tutor.startSession({ childId: 'child-lookup' });

    const state = tutor.getSession({ sessionId: session.sessionId });

    assert.equal(state.status, 'active');
    assert.equal(state.childId, 'child-lookup');
    assert.equal(state.question?.id, session.question.id);
    assert.equal('correctAnswer' in (state.question ?? {}), false);
  });
});
