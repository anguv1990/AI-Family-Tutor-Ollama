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

  it('keeps every answer tappable on the 0-10 pad', () => {
    for (const template of templates) {
      const answer = Number(template.correctAnswer);
      assert.ok(
        Number.isInteger(answer) && answer >= 0 && answer <= 10,
        `${template.id} answers ${template.correctAnswer}, which the child cannot tap`,
      );
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
    for (const expected of ['addition', 'count-on', 'count-back', 'named-number']) {
      assert.ok(shapes.has(expected), `no ${expected} questions are under review`);
    }
  });
});
