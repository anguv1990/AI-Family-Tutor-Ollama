import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SAFETY_RULES,
  screenChildText,
  screenStructuredValue,
} from '../server/ai/safety';

/**
 * The screening table, as a table. A newly observed failure mode belongs here
 * as one row plus one rule, not as a new code path.
 */
const BLOCKED_CASES: Array<{ rule: string; text: string }> = [
  { rule: 'empty', text: '   ' },
  { rule: 'too-long', text: 'count on '.repeat(40) },
  { rule: 'url', text: 'Look at http://example.com for help.' },
  { rule: 'url', text: 'Visit www.mathshelp.org and try again.' },
  { rule: 'url', text: 'Ask a grown-up to open mathsgames.com with you.' },
  { rule: 'email-address', text: 'Write to tutor@example.com if you are stuck.' },
  { rule: 'phone-number', text: 'Ring 07700900123 for help counting.' },
  { rule: 'phone-number', text: 'Call 0117 496 0000 now.' },
  { rule: 'contact-request', text: 'Text me when you have finished this one.' },
  { rule: 'contact-request', text: 'Give me your phone number so we can chat.' },
  { rule: 'contact-request', text: 'Follow me for more counting games.' },
  { rule: 'personal-data-request', text: 'What is your name and how old are you?' },
  { rule: 'personal-data-request', text: 'Tell me your school before we carry on.' },
  { rule: 'personal-data-request', text: 'Where do you live? We can count houses.' },
  { rule: 'disallowed-characters', text: 'Great counting! 🎉' },
  { rule: 'disallowed-characters', text: 'Count them <b>all</b> up.' },
];

const ALLOWED_CASES: string[] = [
  'Hold up fingers for the first number, then count on for the second one.',
  'Count out loud: 1 2 3 4 5, and stop when you run out.',
  'Look at the shape of the number and say it out loud.',
  'Use your fingers - it is fine to start again!',
  'Try 2 + 3 by counting on from the bigger number.',
];

describe('child-output safety screening', () => {
  for (const testCase of BLOCKED_CASES) {
    it(`blocks ${testCase.rule}: ${testCase.text.slice(0, 40)}`, () => {
      const result = screenChildText(testCase.text);
      assert.equal(result.allowed, false);
      assert.ok(
        !result.allowed && result.violations.includes(testCase.rule),
        `expected rule ${testCase.rule}, got ${
          result.allowed ? 'none' : result.violations.join(',')
        }`,
      );
    });
  }

  for (const text of ALLOWED_CASES) {
    it(`allows a normal hint: ${text.slice(0, 40)}`, () => {
      assert.deepEqual(screenChildText(text), { allowed: true });
    });
  }

  it('has a unique id and description for every rule', () => {
    const ids = SAFETY_RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(SAFETY_RULES.every((rule) => rule.description.length > 0));
  });

  it('applies the length cap from the caller', () => {
    const text = 'Count on from the bigger number.';
    assert.deepEqual(screenChildText(text, { maxLength: 200 }), { allowed: true });
    const capped = screenChildText(text, { maxLength: 10 });
    assert.ok(!capped.allowed && capped.violations.includes('too-long'));
  });

  it('screens every string inside a structured value, however deeply nested', () => {
    const result = screenStructuredValue({
      hint: 'Count on your fingers.',
      extras: [{ note: 'Email tutor@example.com' }],
    });
    assert.ok(!result.allowed && result.violations.includes('email-address'));
    assert.deepEqual(screenStructuredValue({ hint: 'Count on your fingers.', steps: 3 }), {
      allowed: true,
    });
  });
});
