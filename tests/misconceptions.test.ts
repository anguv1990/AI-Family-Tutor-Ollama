import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnose } from '../server/misconceptions';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { receptionMathsBank } from '../server/content-bank';

/**
 * Diagnosis is the answer to the question the first child observation could not
 * reach: what happens after a wrong answer. It must be right, because telling a
 * four-year-old the wrong thing about their own mistake is worse than saying
 * nothing.
 */

describe('diagnosing a wrong answer', () => {
  const cases: Array<[string, string, string, string]> = [
    // prompt, correct, given, expected pattern
    ['What is 3 + 2?', '5', '3', 'counts_all_from_one'],
    ['What is 3 + 2?', '5', '2', 'counts_all_from_one'],
    ['What is 3 + 2?', '5', '6', 'skips_or_double_counts'],
    ['What is 3 + 4?', '7', '12', 'used_the_wrong_operation'],
    ['What is 34 add 5?', '39', '38', 'skips_or_double_counts'],
    ['What is 72 subtract 46?', '26', '118', 'used_the_wrong_operation'],
    ['What is 8 times 7?', '56', '15', 'used_the_wrong_operation'],
    ['What is 8 times 7?', '56', '48', 'one_group_out'],
    ['What is 20 shared into groups of 2?', '10', '18', 'used_the_wrong_operation'],
    ['Count on. 1, 2. What comes next?', '3', '2', 'recounts_when_asked_how_many'],
    ['Count on. 3, 4. What comes next?', '5', '3', 'confuses_more_and_less'],
    ['Count on in 5s. 10, 15, 20. What comes next?', '25', '21', 'always_counts_one_by_one'],
    ['In the number 347, which digit is in the tens column?', '4', '347', 'gives_the_whole_number'],
    ['In the number 347, which digit is in the tens column?', '4', '7', 'reads_the_wrong_column'],
    ['47 is 40 add what?', '7', '47', 'gives_the_whole_number'],
    ['Which number is larger, 34 or 43?', '43', '34', 'confuses_more_and_less'],
    ['Tap the bigger number. 1 or 3.', '3', '1', 'confuses_more_and_less'],
    ['What is one quarter of 20?', '5', '20', 'gives_the_whole_amount'],
    ['What is one quarter of 20?', '5', '4', 'answers_the_denominator'],
    ['What is three quarters of 20?', '15', '5', 'finds_one_part_only'],
  ];

  for (const [prompt, correctAnswer, givenAnswer, pattern] of cases) {
    it(`reads "${givenAnswer}" for "${prompt}" as ${pattern}`, () => {
      const found = diagnose({ prompt, correctAnswer, givenAnswer });
      assert.ok(found, 'no diagnosis');
      assert.equal(found.pattern, pattern);
      assert.ok(found.childHelp.length > 0 && found.adultNote.length > 0);
    });
  }

  it('says nothing about a correct answer', () => {
    assert.equal(
      diagnose({ prompt: 'What is 3 + 2?', correctAnswer: '5', givenAnswer: '5' }),
      null,
    );
  });

  it('prefers a miscount to multiplying when the two collide', () => {
    // 3 + 2 answered 6 is both 3 x 2 and 5 + 1. A Reception child has not met
    // multiplication, so "you multiplied" would be a confusing lie.
    const found = diagnose({ prompt: 'What is 3 + 2?', correctAnswer: '5', givenAnswer: '6' });
    assert.equal(found?.pattern, 'skips_or_double_counts');
  });

  it('never tells the child the answer', () => {
    for (const [prompt, correctAnswer, givenAnswer] of cases) {
      const found = diagnose({ prompt, correctAnswer, givenAnswer })!;
      const digits: string[] = found.childHelp.match(/\d+/g) ?? [];
      assert.ok(
        !digits.includes(correctAnswer),
        `help for "${prompt}" leaks the answer: ${found.childHelp}`,
      );
    }
  });

  it('falls back to something kind rather than nothing', () => {
    const found = diagnose({
      prompt: 'What is 3 + 2?',
      correctAnswer: '5',
      givenAnswer: '9',
    });
    assert.ok(found && found.childHelp.length > 0);
  });

  it('survives an answer that is not a number', () => {
    assert.equal(
      diagnose({ prompt: 'What is 3 + 2?', correctAnswer: '5', givenAnswer: 'banana' }),
      null,
    );
  });

  it('offers help for a wrong answer to every question in the bank', () => {
    // Answering one more than the key is the commonest slip there is; every
    // question should have something to say about it.
    for (const skill of receptionMathsBank) {
      for (const template of skill.templates) {
        const given = String(Number(template.correctAnswer) + 1);
        const found = diagnose({
          prompt: template.prompt,
          correctAnswer: template.correctAnswer,
          givenAnswer: given,
        });
        assert.ok(found, `${template.id} produced no help for a wrong answer`);
        assert.ok(found.childHelp.trim().length > 0, template.id);
      }
    }
  });
});

describe('recording a misconception', () => {
  it('returns help to the child and stores the pattern for an adult', () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'kid', yearGroup: 'reception' });

    // "What is 1 + 1?" answered 1 — counted one group and stopped.
    const result = tutor.submitAnswer({
      sessionId: session.sessionId!,
      questionId: session.question!.id,
      answer: '1',
    });

    assert.equal(result.correct, false);
    assert.ok(result.help && result.help.length > 0, 'a wrong answer must come with help');

    const stored = database
      .prepare('SELECT misconception FROM attempts WHERE child_id = ?')
      .get('kid') as { misconception: string | null };
    assert.equal(stored.misconception, 'counts_all_from_one');
    database.close();
  });

  it('records nothing and offers no help when the answer is right', () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'kid', yearGroup: 'reception' });

    const result = tutor.submitAnswer({
      sessionId: session.sessionId!,
      questionId: session.question!.id,
      answer: '2',
    });

    assert.equal(result.correct, true);
    assert.equal(result.help, undefined, 'praise with a correction attached is a correction');

    const stored = database
      .prepare('SELECT misconception FROM attempts WHERE child_id = ?')
      .get('kid') as { misconception: string | null };
    assert.equal(stored.misconception, null);
    database.close();
  });

  it('does not let a diagnosis change the mark or the mastery', () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'kid', yearGroup: 'reception' });

    const result = tutor.submitAnswer({
      sessionId: session.sessionId!,
      questionId: session.question!.id,
      answer: '1',
    });

    assert.equal(result.correct, false);
    assert.equal(result.mastery.correctAttempts, 0);
    assert.equal(result.mastery.totalAttempts, 1);
    database.close();
  });
});
