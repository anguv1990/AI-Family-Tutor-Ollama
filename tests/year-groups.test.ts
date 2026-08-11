import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { receptionMathsBank } from '../server/content-bank';
import { createApp } from '../server/app';
import type { AddressInfo } from 'node:net';

/**
 * Two children, two curricula, one app. The failure that matters is a child
 * being taught the wrong year's maths — an eight-year-old given "1 + 1", or a
 * four-year-old given the eight times table. Neither is caught by any test
 * that only checks a session runs.
 */

describe('year groups', () => {
  let database: Database.Database;
  let tutor: TutoringService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    tutor = new TutoringService(database);
    tutor.seedInitialContent();
  });

  afterEach(() => database.close());

  it('starts a Year 3 child on Year 3 maths', () => {
    const session = tutor.startSession({ childId: 'older', yearGroup: 'year3' });

    assert.equal(session.status, 'active');
    assert.ok(session.skillId.startsWith('year3.'), session.skillId);
    assert.ok(session.question);
    assert.equal(session.question?.answerEntry, 'keypad');
  });

  it('starts a Reception child on Reception maths', () => {
    const session = tutor.startSession({ childId: 'younger', yearGroup: 'reception' });

    assert.ok(session.skillId.startsWith('reception.'), session.skillId);
    assert.equal(session.question?.answerEntry, 'tap-0-10');
  });

  it('never serves a Year 3 child a Reception question, or the reverse', () => {
    for (const [childId, yearGroup] of [
      ['older', 'year3'],
      ['younger', 'reception'],
    ] as const) {
      let session = tutor.startSession({ childId, yearGroup });
      const seen: string[] = [];

      // Walk the whole sitting, not just the first question: selection could
      // drift on any later step.
      let question = session.question;
      while (question) {
        seen.push(question.skillId);
        const result = tutor.submitAnswer({
          sessionId: session.sessionId!,
          questionId: question.id,
          answer: '0',
        });
        question = result.nextQuestion;
      }

      assert.ok(seen.length > 0, `${childId} was asked nothing`);
      for (const skillId of seen) {
        assert.ok(
          skillId.startsWith(`${yearGroup === 'year3' ? 'year3' : 'reception'}.`),
          `${childId} (${yearGroup}) was asked a ${skillId} question`,
        );
      }
    }
  });

  it('refuses a skill from another year group instead of quietly swapping it', () => {
    // Silently redirecting would look like a bug to the adult who chose it.
    assert.throws(
      () =>
        tutor.startSession({
          childId: 'older',
          yearGroup: 'year3',
          skillId: 'reception.counting-to-10',
        }),
      /year group/,
    );
  });

  it('lists only the skills for the year group asked for', () => {
    const year3 = tutor.listSkills('year3');
    const year2 = tutor.listSkills('year2');
    const reception = tutor.listSkills('reception');

    assert.ok(year3.length > 0 && year2.length > 0 && reception.length > 0);
    assert.equal(
      year3.length + year2.length + reception.length,
      receptionMathsBank.length,
    );
    for (const skill of year2) {
      assert.equal(skill.yearGroup, 'year2');
      assert.ok(skill.questionCount >= 20, `${skill.id}: ${skill.questionCount}`);
    }
    for (const skill of year3) {
      assert.equal(skill.yearGroup, 'year3');
      assert.equal(skill.answerEntry, 'keypad');
      assert.ok(skill.questionCount >= 20, `${skill.id}: ${skill.questionCount}`);
    }
    for (const skill of reception) {
      assert.equal(skill.yearGroup, 'reception');
      assert.equal(skill.answerEntry, 'tap-0-10');
    }
  });

  it('keeps a child in the year group they were first recorded with', () => {
    tutor.startSession({ childId: 'older', yearGroup: 'year3' });
    tutor.completeSession({
      sessionId: tutor.startSession({ childId: 'older' }).sessionId!,
    });

    // A stale browser tab or a mistyped link must not move a child's curriculum.
    const relisted = tutor.startSession({ childId: 'older', yearGroup: 'reception' });
    assert.equal(tutor.getYearGroup('older'), 'year3');
    if (relisted.skillId) assert.ok(relisted.skillId.startsWith('year3.'));
  });

  it('accepts every year group the engine teaches, over HTTP', async () => {
    // The engine and the API each had their own idea of which year groups
    // exist, and adding Year 2 to one left the other rejecting it.
    const server = createApp(tutor).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    for (const yearGroup of ['reception', 'year2', 'year3'] as const) {
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ childId: `http-${yearGroup}`, yearGroup }),
      });
      assert.equal(response.status, 201, yearGroup);
      const body = (await response.json()) as { skillId: string };
      assert.ok(body.skillId.startsWith(yearGroup === 'reception' ? 'reception.' : `${yearGroup}.`));

      const skills = await fetch(
        `http://127.0.0.1:${port}/api/skills?yearGroup=${yearGroup}`,
      );
      assert.equal(skills.status, 200, `skills for ${yearGroup}`);
      const listed = (await skills.json()) as { skills: unknown[] };
      assert.ok(listed.skills.length > 0, `no skills listed for ${yearGroup}`);
    }

    const bogus = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'x', yearGroup: 'year9' }),
    });
    assert.equal(bogus.status, 400);

    server.close();
  });

  it('keeps mastery separate for each child', () => {
    const older = tutor.startSession({ childId: 'older', yearGroup: 'year3' });
    tutor.submitAnswer({
      sessionId: older.sessionId!,
      questionId: older.question!.id,
      answer: older.question!.prompt === 'What is 3 times 1?' ? '3' : '0',
    });

    const younger = tutor.startSession({ childId: 'younger', yearGroup: 'reception' });
    assert.equal(younger.mastery.totalAttempts, 0, 'one child inherited the other’s evidence');
  });
});
