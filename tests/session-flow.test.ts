import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { receptionMathsBank } from '../server/content-bank';

/** Mastery without its review timestamp, which is a clock value, not a rule. */
function masteryCore(mastery: Record<string, unknown>) {
  const { nextReviewAt, ...core } = mastery as { nextReviewAt?: unknown };
  return core;
}


/**
 * Starting a session can legitimately answer "nothing to practise right now",
 * so every test that expects a question narrows the result once, here, rather
 * than asserting non-null at each use.
 */
function startActive(
  tutor: TutoringService,
  input: { childId: string; skillId?: string },
) {
  const result = tutor.startSession(input);
  assert.ok(
    result.sessionId && result.question,
    `expected an active session, got ${result.status}`,
  );
  return { ...result, sessionId: result.sessionId, question: result.question };
}

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
    const session = startActive(tutor, { childId: 'child-1' });

    assert.equal(session.childId, 'child-1');
    assert.equal(session.question.skillId, 'reception.addition-within-5');
    assert.equal(session.question.prompt, 'What is 1 + 1?');
    assert.equal('correctAnswer' in session.question, false);
  });

  it('marks an answer, persists the attempt, updates mastery, and selects the next question', () => {
    const session = startActive(tutor, { childId: 'child-1' });

    const result = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: ' 2 ',
    });

    assert.equal(result.correct, true);
    assert.deepEqual(masteryCore(result.mastery), {
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
    const session = startActive(tutor, { childId: 'child-2' });

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
    const session = startActive(tutor, { childId: 'child-3' });
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
    const session = startActive(tutor, { childId: 'child-skip' });

    const result = tutor.skipQuestion({
      sessionId: session.sessionId,
      questionId: session.question.id,
    });

    assert.deepEqual(masteryCore(result.mastery), {
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
    let session = startActive(tutor, { childId: 'child-progress' });

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
    const first = startActive(tutor, { childId: 'child-resume' });
    const second = startActive(tutor, { childId: 'child-resume' });

    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.resumed, true);
    assert.equal(second.question.id, first.question.id);

    const sessions = database
      .prepare('SELECT COUNT(*) AS total FROM sessions WHERE child_id = ?')
      .get('child-resume') as { total: number };
    assert.equal(sessions.total, 1);
  });

  it('resumes at the question the child had not yet answered', () => {
    const started = startActive(tutor, { childId: 'child-resume-progress' });
    const answered = tutor.submitAnswer({
      sessionId: started.sessionId,
      questionId: started.question.id,
      answer: '2',
    });

    const resumed = startActive(tutor, { childId: 'child-resume-progress' });

    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(resumed.question.id, answered.nextQuestion?.id);
    assert.deepEqual(resumed.mastery, answered.mastery);
  });

  it('completes a session explicitly and refuses further answers', () => {
    const session = startActive(tutor, { childId: 'child-complete' });

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
    const session = startActive(tutor, { childId: 'child-complete-count' });
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
    const session = startActive(tutor, { childId: 'child-complete-twice' });
    tutor.completeSession({ sessionId: session.sessionId });

    assert.throws(
      () => tutor.completeSession({ sessionId: session.sessionId }),
      /active session not found/i,
    );
  });

  it('starts a fresh session once the previous one was completed', () => {
    const first = startActive(tutor, { childId: 'child-second-session' });
    tutor.completeSession({ sessionId: first.sessionId });
    // The daily cap is what stops a second session, not the completed one; a
    // parent who has raised it gets a genuinely new session.
    database
      .prepare('UPDATE children SET daily_session_limit = 2 WHERE id = ?')
      .run('child-second-session');

    const second = startActive(tutor, { childId: 'child-second-session' });

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(second.resumed, false);
  });

  it('reports an exhausted session rather than ending silently', () => {
    const session = startActive(tutor, { childId: 'child-exhaust' });

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
    const session = startActive(tutor, {
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
    // Two skills in one day is above the default wellbeing cap, so this test
    // sets the child up the way a parent who wanted both would.
    database
      .prepare(
        `INSERT INTO children (id, daily_session_limit) VALUES (?, 2)
         ON CONFLICT (id) DO UPDATE SET daily_session_limit = 2`,
      )
      .run('child-two-skills');
    const counting = startActive(tutor, {
      childId: 'child-two-skills',
      skillId: 'reception.counting-to-10',
    });
    tutor.submitAnswer({
      sessionId: counting.sessionId,
      questionId: counting.question.id,
      answer: answerKeyFor(counting.question.id),
    });
    tutor.completeSession({ sessionId: counting.sessionId });

    const addition = startActive(tutor, {
      childId: 'child-two-skills',
      skillId: 'reception.addition-within-5',
    });

    assert.equal(addition.mastery.skillId, 'reception.addition-within-5');
    assert.equal(addition.mastery.totalAttempts, 0);
    assert.equal(addition.mastery.level, 'new');
  });

  it('resumes the skill the session was started with, ignoring a new one', () => {
    const started = startActive(tutor, {
      childId: 'child-skill-resume',
      skillId: 'reception.number-recognition',
    });

    const resumed = startActive(tutor, {
      childId: 'child-skill-resume',
      skillId: 'reception.addition-within-5',
    });

    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(resumed.skillId, 'reception.number-recognition');
    assert.equal(resumed.question.id, started.question.id);
  });

  it('refuses an unknown or disabled skill', () => {
    assert.throws(
      () => startActive(tutor, { childId: 'child-bad-skill', skillId: 'nope' }),
      /skill not found/i,
    );

    database
      .prepare("UPDATE skills SET enabled = 0 WHERE id = 'reception.counting-to-10'")
      .run();
    assert.throws(
      () =>
        startActive(tutor, {
          childId: 'child-off-skill',
          skillId: 'reception.counting-to-10',
        }),
      /skill not found/i,
    );
  });

  it('lists the enabled skills with their reviewed question counts', () => {
    const skills = tutor.listSkills();

    assert.equal(skills.length, receptionMathsBank.length);
    for (const skill of skills) {
      assert.ok(skill.title.trim());
      assert.ok(skill.questionCount >= 20, `${skill.id}: ${skill.questionCount}`);
    }
  });

  it('reads back the current state of an active session', () => {
    const session = startActive(tutor, { childId: 'child-lookup' });

    const state = tutor.getSession({ sessionId: session.sessionId });

    assert.equal(state.status, 'active');
    assert.equal(state.childId, 'child-lookup');
    assert.equal(state.question?.id, session.question.id);
    assert.equal('correctAnswer' in (state.question ?? {}), false);
  });
});

describe('session stopping rule', () => {
  const startOfSession = new Date('2026-08-11T09:00:00Z');
  let database: Database.Database;
  let clock: { current: Date };
  let tutor: TutoringService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    clock = { current: startOfSession };
    tutor = new TutoringService(database, { now: () => clock.current });
    tutor.seedInitialContent();
  });

  afterEach(() => database.close());

  const answerKeyFor = (templateId: string): string =>
    (
      database
        .prepare('SELECT correct_answer FROM content_templates WHERE id = ?')
        .get(templateId) as { correct_answer: string }
    ).correct_answer;

  const storedSession = (
    sessionId: string,
  ): { ended_at: string | null; ended_reason: string | null; current_question_id: string | null } =>
    database
      .prepare(
        `SELECT ended_at, ended_reason, current_question_id
         FROM sessions WHERE id = ?`,
      )
      .get(sessionId) as {
      ended_at: string | null;
      ended_reason: string | null;
      current_question_id: string | null;
    };

  /**
   * The wellbeing cap allows one session a day. These tests are about the
   * stopping rule, so they set the child up the way a parent who wanted a
   * second sitting would.
   */
  const allowTwoSessionsToday = (childId: string): void => {
    database
      .prepare(
        `INSERT INTO children (id, daily_session_limit) VALUES (?, 2)
         ON CONFLICT (id) DO UPDATE SET daily_session_limit = 2`,
      )
      .run(childId);
  };

  it('ends the session on the eighth answered question', () => {
    const session = startActive(tutor, { childId: 'child-eight' });

    let question = session.question;
    let result!: ReturnType<TutoringService['submitAnswer']>;
    for (let answered = 0; answered < 8; answered += 1) {
      result = tutor.submitAnswer({
        sessionId: session.sessionId,
        questionId: question.id,
        answer: answerKeyFor(question.id),
      });
      if (result.nextQuestion) question = result.nextQuestion;
    }

    // The eighth answer is still marked and still counts as evidence; only the
    // question that would have followed it is withheld.
    assert.equal(result.correct, true);
    assert.equal(result.mastery.totalAttempts, 8);
    assert.equal(result.status, 'question_limit');
    assert.equal(result.nextQuestion, null);

    const stored = storedSession(session.sessionId);
    assert.equal(stored.ended_reason, 'question_limit');
    assert.ok(stored.ended_at);
    assert.equal(stored.current_question_id, null);
    assert.equal(
      tutor.getSession({ sessionId: session.sessionId }).status,
      'question_limit',
    );
  });

  it('does not count skipped questions towards the question limit', () => {
    const session = startActive(tutor, { childId: 'child-skipper' });

    let question = session.question;
    for (let skipped = 0; skipped < 5; skipped += 1) {
      const outcome = tutor.skipQuestion({
        sessionId: session.sessionId,
        questionId: question.id,
      });
      assert.equal(outcome.status, 'active');
      question = outcome.nextQuestion!;
    }

    let result!: ReturnType<TutoringService['submitAnswer']>;
    for (let answered = 0; answered < 7; answered += 1) {
      result = tutor.submitAnswer({
        sessionId: session.sessionId,
        questionId: question.id,
        answer: answerKeyFor(question.id),
      });
      question = result.nextQuestion!;
    }

    assert.equal(result.status, 'active', 'five skips plus seven answers');

    const eighth = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: question.id,
      answer: answerKeyFor(question.id),
    });
    assert.equal(eighth.status, 'question_limit');
  });

  it('ends the session once ten minutes have elapsed', () => {
    const session = startActive(tutor, { childId: 'child-clock' });

    clock.current = new Date('2026-08-11T09:09:59Z');
    const inTime = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: answerKeyFor(session.question.id),
    });
    assert.equal(inTime.status, 'active');

    clock.current = new Date('2026-08-11T09:10:00Z');
    const result = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: inTime.nextQuestion!.id,
      answer: answerKeyFor(inTime.nextQuestion!.id),
    });

    assert.equal(result.correct, true);
    assert.equal(result.mastery.totalAttempts, 2, 'the answer is still marked');
    assert.equal(result.status, 'time_limit');
    assert.equal(result.nextQuestion, null);

    const stored = storedSession(session.sessionId);
    assert.equal(stored.ended_reason, 'time_limit');
    assert.equal(stored.current_question_id, null);
  });

  it('ends the session on time even when the child only skips', () => {
    const session = startActive(tutor, { childId: 'child-clock-skip' });

    clock.current = new Date('2026-08-11T09:30:00Z');
    const result = tutor.skipQuestion({
      sessionId: session.sessionId,
      questionId: session.question.id,
    });

    assert.equal(result.status, 'time_limit');
    assert.equal(result.nextQuestion, null);
  });

  it('reports the child stopping and content exhaustion as their own reasons', () => {
    const chosen = startActive(tutor, { childId: 'child-chose-stop' });
    assert.equal(
      tutor.completeSession({ sessionId: chosen.sessionId }).endedReason,
      'completed',
    );
    assert.equal(
      storedSession(chosen.sessionId).current_question_id,
      null,
      'an ended session never still points at an answerable question',
    );

    // Only one reviewed question left in the whole skill, so the session runs
    // out of content before either limit can fire.
    const session = startActive(tutor, {
      childId: 'child-out-of-content',
      skillId: 'reception.counting-to-10',
    });
    database
      .prepare(
        `UPDATE content_templates SET enabled = 0
         WHERE skill_id = 'reception.counting-to-10' AND id != ?`,
      )
      .run(session.question.id);

    const result = tutor.skipQuestion({
      sessionId: session.sessionId,
      questionId: session.question.id,
    });

    assert.equal(result.status, 'exhausted');
    assert.equal(storedSession(session.sessionId).ended_reason, 'exhausted');
  });

  it('starts a fresh session instead of resuming one past the time limit', () => {
    allowTwoSessionsToday('child-stale');
    const stale = startActive(tutor, { childId: 'child-stale' });

    clock.current = new Date('2026-08-11T09:11:00Z');
    const fresh = startActive(tutor, { childId: 'child-stale' });

    assert.equal(fresh.resumed, false);
    assert.notEqual(fresh.sessionId, stale.sessionId);
    const stored = storedSession(stale.sessionId);
    assert.equal(stored.ended_reason, 'time_limit');
    assert.equal(stored.current_question_id, null);
  });

  it('starts a fresh session instead of resuming one past the question limit', () => {
    allowTwoSessionsToday('child-stale-count');
    const stale = startActive(tutor, { childId: 'child-stale-count' });

    // Written straight to the table: a session recorded before this rule
    // existed can hold more answers than the limit now allows.
    const insert = database.prepare(
      `INSERT INTO attempts
         (id, session_id, child_id, template_id, template_version, answer, is_correct)
       SELECT ?, ?, 'child-stale-count', id, version, correct_answer, 1
       FROM content_templates
       WHERE skill_id = 'reception.addition-within-5' AND id != ?
       ORDER BY sequence LIMIT 1 OFFSET ?`,
    );
    for (let index = 0; index < 8; index += 1) {
      insert.run(`stale-${index}`, stale.sessionId, stale.question.id, index);
    }

    const fresh = startActive(tutor, { childId: 'child-stale-count' });

    assert.equal(fresh.resumed, false);
    assert.equal(storedSession(stale.sessionId).ended_reason, 'question_limit');
  });
});

describe('question selection', () => {
  const now = new Date('2026-08-11T09:00:00Z');
  let database: Database.Database;
  let tutor: TutoringService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    tutor = new TutoringService(database, { now: () => now });
    tutor.seedInitialContent();

    // A purpose-built skill: every exclusion the selector has to make is one
    // template, so what it serves says exactly which rule fired.
    database
      .prepare(
        `INSERT INTO skills (id, title, curriculum_version, enabled)
         VALUES ('test.selection', 'Selection fixture', 'test', 1)`,
      )
      .run();
    const insertTemplate = database.prepare(
      `INSERT INTO content_templates
         (id, skill_id, version, prompt, correct_answer, difficulty, sequence,
          source, licence, reviewed, enabled)
       VALUES (?, ?, 1, ?, '1', 1, ?, 'test', 'test', ?, ?)`,
    );
    const fixtures: Array<[string, string, number, number, number]> = [
      // id, skill, sequence, reviewed, enabled
      ['sel-other-skill', 'reception.counting-to-10', -1, 1, 1],
      ['sel-recent', 'test.selection', 1, 1, 1],
      ['sel-disabled', 'test.selection', 2, 1, 0],
      ['sel-unreviewed', 'test.selection', 3, 0, 1],
      ['sel-stale', 'test.selection', 4, 1, 1],
      ['sel-b', 'test.selection', 5, 1, 1],
      ['sel-a', 'test.selection', 5, 1, 1],
    ];
    for (const [id, skillId, sequence, reviewed, enabled] of fixtures) {
      insertTemplate.run(id, skillId, `Fixture ${id}`, sequence, reviewed, enabled);
    }

    // Yesterday's session for one child only, so the 24-hour window is proven
    // to be per child and to span sessions rather than per session.
    database.prepare('INSERT INTO children (id) VALUES (?)').run('sel-child');
    database
      .prepare(
        `INSERT INTO sessions (id, child_id, skill_id, started_at, ended_at, ended_reason)
         VALUES ('sel-prior', 'sel-child', 'test.selection',
                 '2026-08-10 07:00:00', '2026-08-10 07:20:00', 'completed')`,
      )
      .run();
    const insertAttempt = database.prepare(
      `INSERT INTO attempts
         (id, session_id, child_id, template_id, template_version, answer,
          is_correct, created_at)
       VALUES (?, 'sel-prior', 'sel-child', ?, 1, '1', 1, ?)`,
    );
    insertAttempt.run('sel-attempt-recent', 'sel-recent', '2026-08-10 23:00:00');
    insertAttempt.run('sel-attempt-stale', 'sel-stale', '2026-08-10 07:00:00');
  });

  afterEach(() => database.close());

  it('serves only reviewed, enabled, in-skill templates the child has not just seen', () => {
    const session = startActive(tutor, {
      childId: 'sel-child',
      skillId: 'test.selection',
    });

    const served = [session.question.id];
    let next = session.question.id;
    for (;;) {
      const outcome = tutor.skipQuestion({
        sessionId: session.sessionId,
        questionId: next,
      });
      if (!outcome.nextQuestion) {
        assert.equal(outcome.status, 'exhausted');
        break;
      }
      next = outcome.nextQuestion.id;
      served.push(next);
    }

    assert.deepEqual(
      served,
      ['sel-stale', 'sel-a', 'sel-b'],
      'sel-recent is inside the 24-hour window, sel-disabled and ' +
        'sel-unreviewed fail their gates, sel-other-skill is another skill, ' +
        'sel-stale was attempted 26 hours ago, and the sel-a/sel-b tie on ' +
        'sequence breaks on template ID',
    );
  });

  it('applies the re-ask window per child rather than globally', () => {
    const other = startActive(tutor, {
      childId: 'sel-other-child',
      skillId: 'test.selection',
    });

    assert.equal(
      other.question.id,
      'sel-recent',
      'another child has never seen sel-recent, so the window does not apply',
    );
  });
});
