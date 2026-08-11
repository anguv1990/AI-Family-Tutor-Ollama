import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { receptionMathsBank } from '../server/content-bank';

/**
 * Day 29 — independent verification of every enabled answer key.
 *
 * The risk register rates "a reviewed answer key is subtly wrong" as medium
 * likelihood and high impact, and an adult re-reading sixty prompts is exactly
 * the kind of review that passes when it should not. So this re-derives every
 * answer from the prompt text alone, without consulting the stored key, and
 * compares afterwards.
 *
 * A prompt that matches no known shape is a failure, not a skip. New content
 * must either be mechanically checkable or force a deliberate decision here —
 * otherwise this suite quietly stops covering the bank as it grows.
 */

const FRACTION_WORDS: Record<string, [number, number]> = {
  'one half': [1, 2],
  'one third': [1, 3],
  'one quarter': [1, 4],
  'one fifth': [1, 5],
  'one eighth': [1, 8],
  'one tenth': [1, 10],
  'two thirds': [2, 3],
  'two quarters': [2, 4],
  'three quarters': [3, 4],
  'two fifths': [2, 5],
  'three tenths': [3, 10],
  'five eighths': [5, 8],
};

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

type Derivation = { answer: number; shape: string };

/** Re-derives the answer from the prompt, or undefined if the shape is unknown. */
function deriveAnswer(prompt: string): Derivation | undefined {
  const addition = prompt.match(/^What is (\d+) \+ (\d+)\?$/);
  if (addition) {
    return { answer: Number(addition[1]) + Number(addition[2]), shape: 'addition' };
  }

  const stepped = prompt.match(/^Count on in (\d+)s\. ([\d, ]+)\. What comes next\?$/);
  if (stepped) {
    const step = Number(stepped[1]);
    const run = stepped[2].split(',').map((value) => Number(value.trim()));
    for (let index = 1; index < run.length; index += 1) {
      assert.equal(
        run[index] - run[index - 1],
        step,
        `"${prompt}" claims steps of ${step} but the run does not`,
      );
    }
    return { answer: run[run.length - 1] + step, shape: 'count-in-steps' };
  }

  const partition = prompt.match(/^(\d+) is (\d+) add what\?$/);
  if (partition) {
    return { answer: Number(partition[1]) - Number(partition[2]), shape: 'partition' };
  }

  const shared = prompt.match(/^What is (\d+) shared into groups of (\d+)\?$/);
  if (shared) {
    const total = Number(shared[1]);
    const divisor = Number(shared[2]);
    assert.equal(total % divisor, 0, `"${prompt}" does not divide exactly`);
    return { answer: total / divisor, shape: 'sharing' };
  }

  const sequence = prompt.match(/^Count (on|back)\. ([\d, ]+)\. What comes next\?$/);
  if (sequence) {
    const run = sequence[2].split(',').map((value) => Number(value.trim()));
    const step = sequence[1] === 'on' ? 1 : -1;

    // The run itself must be consistent, or the child is being shown a broken
    // pattern regardless of whether the final answer happens to be right.
    for (let index = 1; index < run.length; index += 1) {
      assert.equal(
        run[index] - run[index - 1],
        step,
        `"${prompt}" counts ${sequence[1]} but the run does not step by ${step}`,
      );
    }
    return { answer: run[run.length - 1] + step, shape: `count-${sequence[1]}` };
  }

  const named = prompt.match(/^Tap the number ([a-z]+)\.$/);
  if (named && named[1] in WORD_NUMBERS) {
    return { answer: WORD_NUMBERS[named[1]], shape: 'named-number' };
  }

  const times = prompt.match(/^What is (\d+) times (\d+)\?$/);
  if (times) {
    return { answer: Number(times[1]) * Number(times[2]), shape: 'times-table' };
  }

  const wordSum = prompt.match(/^What is (\d+) (add|subtract) (\d+)\?$/);
  if (wordSum) {
    const left = Number(wordSum[1]);
    const right = Number(wordSum[3]);
    const answer = wordSum[2] === 'add' ? left + right : left - right;
    // A Year 3 subtraction that goes below zero is a content error, not a
    // stretch: the programme of study has not introduced negative numbers.
    assert.ok(answer >= 0, `"${prompt}" has a negative answer`);
    return { answer, shape: `word-${wordSum[2]}` };
  }

  const step = prompt.match(/^What is (10|100) (more|less) than (\d+)\?$/);
  if (step) {
    const delta = Number(step[1]) * (step[2] === 'more' ? 1 : -1);
    return { answer: Number(step[3]) + delta, shape: 'place-value-step' };
  }

  const digit = prompt.match(/^In the number (\d+), which digit is in the (ones|tens|hundreds) column\?$/);
  if (digit) {
    const value = Number(digit[1]);
    const place = digit[2];
    const answer =
      place === 'ones'
        ? value % 10
        : place === 'tens'
          ? Math.floor(value / 10) % 10
          : Math.floor(value / 100) % 10;
    return { answer, shape: 'place-value-digit' };
  }

  const ordering = prompt.match(/^Which number is (larger|smaller), (\d+) or (\d+)\?$/);
  if (ordering) {
    const left = Number(ordering[2]);
    const right = Number(ordering[3]);
    assert.notEqual(left, right, `"${prompt}" compares a number with itself`);
    return {
      answer: ordering[1] === 'larger' ? Math.max(left, right) : Math.min(left, right),
      shape: 'ordering',
    };
  }

  const fraction = prompt.match(/^What is ([a-z ]+) of (\d+)\?$/);
  if (fraction && fraction[1] in FRACTION_WORDS) {
    const [numerator, denominator] = FRACTION_WORDS[fraction[1]];
    const amount = Number(fraction[2]);
    // A fraction of an amount that is not whole would make the child type a
    // remainder or a decimal, which Year 3 has not met yet.
    assert.equal(
      amount % denominator,
      0,
      `"${prompt}" does not divide into a whole number`,
    );
    return { answer: (amount / denominator) * numerator, shape: 'fraction-of-amount' };
  }

  const comparison = prompt.match(/^Tap the (bigger|smaller) number\. (\d+) or (\d+)\.$/);
  if (comparison) {
    const left = Number(comparison[2]);
    const right = Number(comparison[3]);
    assert.notEqual(left, right, `"${prompt}" compares a number with itself`);
    return {
      answer: comparison[1] === 'bigger' ? Math.max(left, right) : Math.min(left, right),
      shape: `comparison-${comparison[1]}`,
    };
  }

  return undefined;
}

describe('reviewed answer keys', () => {
  const templates = receptionMathsBank.flatMap((skill) =>
    skill.templates.map((template) => ({ skillId: skill.id, ...template })),
  );

  it('re-derives every answer from its prompt', () => {
    const wrong: string[] = [];
    const unknown: string[] = [];

    for (const template of templates) {
      const derived = deriveAnswer(template.prompt);
      if (!derived) {
        unknown.push(`${template.id}: "${template.prompt}"`);
        continue;
      }
      if (String(derived.answer) !== String(template.correctAnswer)) {
        wrong.push(
          `${template.id}: "${template.prompt}" is keyed ${template.correctAnswer}, derived ${derived.answer}`,
        );
      }
    }

    assert.deepEqual(unknown, [], 'prompts with no independent check');
    assert.deepEqual(wrong, [], 'answer keys that disagree with their prompt');
  });

  it('keeps every answer enterable by the way its skill is answered', () => {
    for (const skill of receptionMathsBank) {
      for (const template of skill.templates) {
        const answer = Number(template.correctAnswer);
        assert.ok(
          Number.isInteger(answer) && answer >= 0,
          `${template.id} answers ${template.correctAnswer}, which is not a whole number`,
        );
        if (skill.answerEntry === 'tap-0-10') {
          assert.ok(
            answer <= 10,
            `${template.id} answers ${answer}, which is not on the 0-10 tap pad`,
          );
        }
      }
    }
  });

  it('never asks the same question twice in the bank', () => {
    const byPrompt = new Map<string, string[]>();
    for (const template of templates) {
      const key = `${template.skillId}|${template.prompt}`;
      byPrompt.set(key, [...(byPrompt.get(key) ?? []), template.id]);
    }
    const duplicates = [...byPrompt.entries()].filter(([, ids]) => ids.length > 1);
    assert.deepEqual(duplicates, [], 'duplicate prompts within a skill');
  });

  it('covers each shape it claims to review', () => {
    // Guards the reviewer, not the content: if a whole question type vanished
    // from the bank, the derivation above would still pass vacuously.
    const shapes = new Set(
      templates.map((template) => deriveAnswer(template.prompt)?.shape).filter(Boolean),
    );
    for (const expected of [
      'addition',
      'count-on',
      'count-back',
      'named-number',
      'times-table',
      'word-add',
      'word-subtract',
      'place-value-step',
      'place-value-digit',
      'fraction-of-amount',
      'count-in-steps',
      'partition',
      'sharing',
    ]) {
      assert.ok(shapes.has(expected), `no ${expected} questions are under review`);
    }
  });
});

describe('question pictures', () => {
  const reception = receptionMathsBank.filter((skill) => skill.yearGroup === 'reception');

  it('gives every Reception question a picture', () => {
    // A four-year-old who can neither read the prompt nor listens to it has
    // only the picture left. A Reception question without one is unanswerable
    // except by guessing.
    for (const skill of reception) {
      for (const template of skill.templates) {
        assert.ok(template.visual, `${template.id} has no picture`);
      }
    }
  });

  it('shows a picture that agrees with the answer', () => {
    // The picture is the question as far as the child is concerned, so a
    // picture that disagrees with the answer key is worse than none at all.
    for (const skill of reception) {
      for (const template of skill.templates) {
        const visual = template.visual!;
        const answer = Number(template.correctAnswer);

        if (visual.kind === 'groups') {
          const total = visual.groups.reduce((sum, group) => sum + group, 0);
          assert.equal(total, answer, `${template.id}: dots total ${total}, answer ${answer}`);
        } else if (visual.kind === 'count') {
          assert.equal(visual.total, answer, template.id);
        } else if (visual.kind === 'sequence') {
          const shown = visual.shown;
          const step = shown.length > 1 ? shown[1] - shown[0] : 1;
          assert.equal(
            shown[shown.length - 1] + step,
            answer,
            `${template.id}: the track does not lead to ${answer}`,
          );
        } else if (visual.want) {
          const expected =
            visual.want === 'bigger' ? Math.max(...visual.values) : Math.min(...visual.values);
          assert.equal(expected, answer, template.id);
        } else {
          assert.deepEqual(visual.values, [answer], template.id);
        }
      }
    }
  });

  it('keeps every picture countable by a small child', () => {
    for (const skill of reception) {
      for (const template of skill.templates) {
        const visual = template.visual!;
        if (visual.kind === 'groups') {
          for (const group of visual.groups) {
            assert.ok(group >= 0 && group <= 10, `${template.id}: a group of ${group} dots`);
          }
        }
      }
    }
  });

  it('leaves Year 3 questions to be read', () => {
    // Pictures are a Reception aid. An eight-year-old reads the question, and
    // dots for "555 add 278" would be absurd.
    for (const skill of receptionMathsBank.filter((entry) => entry.yearGroup === 'year3')) {
      for (const template of skill.templates) {
        assert.equal(template.visual, undefined, `${template.id} has a picture`);
      }
    }
  });
});
