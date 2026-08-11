import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { SPACED_REVIEW_DAYS, isDue, nextReviewFor } from '../server/spaced-review';

/**
 * The curriculum schedules review at 1, 3, 7, 14 and 30 days. The flat
 * 24-hour rule it replaces was a freshness guard: a skill a child had been
 * secure in for a month came round as often as one they met yesterday.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-08-12T09:00:00.000Z');

describe('the review interval', () => {
  const days = (schedule: { nextReviewAt: Date }) =>
    Math.round((schedule.nextReviewAt.getTime() - START.getTime()) / DAY_MS);

  it('lengthens with each consecutive correct answer', () => {
    assert.equal(days(nextReviewFor([true], START)), 1);
    assert.equal(days(nextReviewFor([true, true], START)), 3);
    assert.equal(days(nextReviewFor([true, true, true], START)), 7);
    assert.equal(days(nextReviewFor([true, true, true, true], START)), 14);
    assert.equal(days(nextReviewFor([true, true, true, true, true], START)), 30);
  });

  it('never grows past the longest interval the curriculum defines', () => {
    const many = new Array(40).fill(true);
    assert.equal(days(nextReviewFor(many, START)), SPACED_REVIEW_DAYS[SPACED_REVIEW_DAYS.length - 1]);
  });

  it('drops back to tomorrow after a wrong answer', () => {
    // The evidence that the skill was secure has just been contradicted.
    assert.equal(days(nextReviewFor([true, true, true, true, false], START)), 1);
  });

  it('counts only the trailing run, not the overall score', () => {
    // Nine right and then two wrong is not a skill due in a month.
    const mostlyRight = [...new Array(9).fill(true), false, false];
    assert.equal(days(nextReviewFor(mostlyRight, START)), 1);
  });

  it('treats a never-practised skill as due', () => {
    assert.equal(isDue(null, START), true);
    assert.equal(isDue(undefined, START), true);
  });

  it('treats an unreadable date as due rather than never', () => {
    // Failing towards "practise it" is the safe direction.
    assert.equal(isDue('not a date', START), true);
  });

  it('compares dates in both stored formats', () => {
    assert.equal(isDue('2026-08-11T09:00:00.000Z', START), true);
    assert.equal(isDue('2026-08-13T09:00:00.000Z', START), false);
    assert.equal(isDue('2026-08-11 09:00:00', START), true);
  });
});

describe('scheduling a child’s skills', () => {
  let database: Database.Database;
  let tutor: TutoringService;
  let clock: { current: Date };

  beforeEach(() => {
    clock = { current: new Date(START) };
    database = createDatabase(':memory:');
    tutor = new TutoringService(database, { now: () => clock.current });
    tutor.seedInitialContent();
  });

  /** Answers one question correctly or otherwise, and ends the sitting. */
  function practise(childId: string, correct: boolean, skillId?: string) {
    const session = tutor.startSession({ childId, yearGroup: 'reception', skillId });
    assert.ok(session.sessionId && session.question, 'expected a question');
    const key = database
      .prepare('SELECT correct_answer FROM content_templates WHERE id = ?')
      .get(session.question.id) as { correct_answer: string };
    const result = tutor.submitAnswer({
      sessionId: session.sessionId,
      questionId: session.question.id,
      answer: correct ? key.correct_answer : 'definitely wrong',
    });
    tutor.completeSession({ sessionId: session.sessionId });
    return { skillId: session.skillId, mastery: result.mastery };
  }

  it('records when a practised skill is next due', () => {
    const { mastery } = practise('kid', true);

    assert.ok(mastery.nextReviewAt, 'a practised skill must be scheduled');
    const due = Date.parse(mastery.nextReviewAt!);
    assert.equal(Math.round((due - START.getTime()) / DAY_MS), 1);
  });

  it('moves to a different skill while the first is not yet due', () => {
    const first = practise('kid', true);

    // Same day: the skill just practised is not due again, so the child should
    // meet new work rather than the same skill twice.
    clock.current = new Date(START.getTime() + 60 * 1000);
    const second = tutor.startSession({ childId: 'kid', yearGroup: 'reception' });

    assert.notEqual(second.skillId, first.skillId);
  });

  it('brings a due skill back before starting new work', () => {
    const first = practise('kid', true);
    // A wrong answer on a second skill schedules it for tomorrow too, so both
    // are due after two days and the more overdue one comes first.
    clock.current = new Date(START.getTime() + 60 * 1000);
    const second = practise('kid', false);
    assert.notEqual(second.skillId, first.skillId);

    clock.current = new Date(START.getTime() + 2 * DAY_MS);
    const back = tutor.startSession({ childId: 'kid', yearGroup: 'reception' });

    assert.equal(back.skillId, first.skillId, 'the most overdue skill comes back first');
  });

  it('keeps a well-known skill away for the full interval', () => {
    let childSkill = '';
    for (let round = 0; round < 5; round += 1) {
      clock.current = new Date(START.getTime() + round * 40 * DAY_MS);
      childSkill = practise('steady', true, 'reception.addition-within-5').skillId;
    }

    const mastery = tutor.startSession({
      childId: 'steady',
      yearGroup: 'reception',
      skillId: childSkill,
    }).mastery;

    const due = Date.parse(mastery.nextReviewAt!);
    const from = new Date(START.getTime() + 4 * 40 * DAY_MS).getTime();
    assert.equal(Math.round((due - from) / DAY_MS), 30, 'five correct earns the longest interval');
  });

  it('never leaves a child with nothing to practise', () => {
    // Whatever the schedule says, starting a session must still offer a skill.
    for (let round = 0; round < 6; round += 1) {
      clock.current = new Date(START.getTime() + round * DAY_MS);
      const session = tutor.startSession({ childId: 'busy', yearGroup: 'reception' });
      assert.ok(session.skillId, `round ${round} offered no skill`);
      if (session.sessionId) tutor.completeSession({ sessionId: session.sessionId });
    }
  });
});
