import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemorySafetyEventSink } from '../server/ai/events';
import { AiGateway } from '../server/ai/gateway';
import {
  HINT_SCHEMA,
  HintService,
  fallbackHintFor,
  hintLeaksAnswer,
} from '../server/ai/hint-service';
import { FakeProvider, type FakeStep } from '../server/ai/providers/fake';

function buildService(script: FakeStep[]) {
  const provider = new FakeProvider(script);
  const events = new MemorySafetyEventSink();
  const gateway = new AiGateway({
    routes: { 'local-fast': { providerId: 'fake', model: 'fake-model', provider } },
    events,
  });
  return { service: new HintService(gateway), provider, events };
}

const QUESTION = {
  questionPrompt: 'What is 2 add 3?',
  skillId: 'reception.addition-within-5',
  difficulty: 1,
  correctAnswer: '5',
};

describe('hint service', () => {
  it('returns a validated hint from the model', async () => {
    const { service, provider } = buildService([
      { kind: 'valid', data: { hint: 'Hold up two fingers, then count on three more.' } },
    ]);

    const result = await service.getHint(QUESTION);

    assert.equal(result.source, 'model');
    assert.equal(result.hint, 'Hold up two fingers, then count on three more.');
    // The correct answer is never sent to the model.
    assert.doesNotMatch(JSON.stringify(provider.calls), /correctAnswer/);
  });

  it('can only ever return a hint, so the model cannot mark or set difficulty', () => {
    assert.deepEqual(Object.keys(HINT_SCHEMA.fields), ['hint']);
  });

  it('rejects a hint that leaks the answer, repairs once, then falls back', async () => {
    const { service, provider, events } = buildService([
      { kind: 'valid', data: { hint: 'The answer is 5, well done.' } },
      { kind: 'valid', data: { hint: 'It is five altogether.' } },
    ]);

    const result = await service.getHint(QUESTION);

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'rejected-output');
    assert.equal(result.hint, fallbackHintFor('reception.addition-within-5'));
    assert.equal(provider.callCount, 2);
    assert.equal(events.ofType('output_rejected').length, 1);
  });

  it('accepts a repaired hint that no longer leaks the answer', async () => {
    const { service, provider } = buildService([
      { kind: 'valid', data: { hint: 'The answer is 5.' } },
      { kind: 'valid', data: { hint: 'Start at the bigger number and count on.' } },
    ]);

    const result = await service.getHint(QUESTION);

    assert.equal(result.source, 'model');
    assert.equal(result.hint, 'Start at the bigger number and count on.');
    assert.equal(provider.callCount, 2);
  });

  it('serves the skill template when the model is unavailable or slow', async () => {
    for (const step of [{ kind: 'unavailable' }, { kind: 'timeout' }] as FakeStep[]) {
      const { service } = buildService([step]);
      const result = await service.getHint({
        ...QUESTION,
        skillId: 'reception.counting-to-10',
        correctAnswer: '7',
      });
      assert.equal(result.source, 'fallback');
      assert.equal(result.hint, fallbackHintFor('reception.counting-to-10'));
    }
  });

  it('serves a generic template for an unknown skill', async () => {
    const { service } = buildService([{ kind: 'timeout' }]);
    const result = await service.getHint({ ...QUESTION, skillId: 'reception.unknown' });
    assert.equal(result.hint, fallbackHintFor('reception.unknown'));
    assert.ok(result.hint.length > 0);
  });

  it('falls back when the model returns unsafe text', async () => {
    const { service, events } = buildService([
      { kind: 'valid', data: { hint: 'Ask a grown-up to email me at tutor@example.com' } },
    ]);

    const result = await service.getHint(QUESTION);

    assert.equal(result.fallbackReason, 'unsafe-output');
    assert.equal(events.ofType('safety_block').length, 1);
  });

  it('detects a leaked answer as a digit or a number word, not as a substring', () => {
    assert.equal(hintLeaksAnswer('It makes 5 altogether.', '5'), true);
    assert.equal(hintLeaksAnswer('It makes five altogether.', '5'), true);
    assert.equal(hintLeaksAnswer('You need 5 fingers.', 'five'), true);
    assert.equal(hintLeaksAnswer('Count on from the bigger number.', '5'), false);
    // "5" must not be found inside "15" or a word.
    assert.equal(hintLeaksAnswer('There are 15 counters on the table.', '5'), false);
    assert.equal(hintLeaksAnswer('Use the fivepin bowling picture.', 'five'), false);
  });
});
