import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiGateway, type GatewayConfig } from '../server/ai/gateway';
import { MemoryCacheStore } from '../server/ai/cache';
import { MemorySafetyEventSink } from '../server/ai/events';
import { FakeProvider, type FakeStep } from '../server/ai/providers/fake';
import type { Schema } from '../server/ai/schema';
import type { StructuredRequest } from '../server/ai/types';

type Nudge = { message: string; tone: 'gentle' | 'cheerful' };

const NUDGE_SCHEMA: Schema<Nudge> = {
  name: 'nudge',
  version: 'v1',
  fields: {
    message: { kind: 'string', minLength: 3, maxLength: 60 },
    tone: { kind: 'enum', values: ['gentle', 'cheerful'] },
  },
};

const FALLBACK: Nudge = { message: 'Have another go, you can do it.', tone: 'gentle' };

function nudgeRequest(overrides: Partial<StructuredRequest<Nudge>> = {}): StructuredRequest<Nudge> {
  return {
    task: 'hint',
    promptVersion: 'nudge.v1',
    messages: [
      { role: 'system', content: 'Encourage the child.' },
      { role: 'user', content: 'Question: 2 add 3' },
    ],
    schema: NUDGE_SCHEMA,
    modelClass: 'local-fast',
    temperature: 0.2,
    maxOutputTokens: 40,
    dataClassification: 'family-private',
    ...overrides,
  };
}

function buildGateway(script: FakeStep[], config: Partial<GatewayConfig> = {}) {
  const provider = new FakeProvider(script);
  const events = new MemorySafetyEventSink();
  const gateway = new AiGateway({
    routes: { 'local-fast': { providerId: 'fake', model: 'fake-model', provider } },
    events,
    ...config,
  });
  return { gateway, provider, events };
}

describe('AI gateway', () => {
  it('returns validated model output on success', async () => {
    const { gateway, events } = buildGateway([
      { kind: 'valid', data: { message: 'Count on your fingers.', tone: 'gentle' } },
    ]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(result.source, 'model');
    assert.equal(result.data.message, 'Count on your fingers.');
    assert.equal(result.fallbackReason, undefined);
    assert.equal(result.provider, 'fake');
    assert.deepEqual(events.events, []);
  });

  it('drops fields the schema did not ask for, so raw model output cannot escape', async () => {
    const { gateway } = buildGateway([
      {
        kind: 'valid',
        data: {
          message: 'Try counting on.',
          tone: 'gentle',
          correct: true,
          rawReply: 'the answer is 5',
        },
      },
    ]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.deepEqual(Object.keys(result.data).sort(), ['message', 'tone']);
  });

  it('falls back and records an event when the provider times out', async () => {
    const { gateway, provider, events } = buildGateway([{ kind: 'timeout' }]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK, sessionId: 's1' });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'timeout');
    assert.deepEqual(result.data, FALLBACK);
    // A transport failure is not repairable by re-prompting.
    assert.equal(provider.callCount, 1);
    assert.equal(events.ofType('fallback_served').length, 1);
    assert.equal(events.ofType('fallback_served')[0].sessionId, 's1');
  });

  it('falls back when the model is unavailable', async () => {
    const { gateway, events } = buildGateway([{ kind: 'unavailable', detail: 'not pulled' }]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'unavailable');
    assert.equal(events.ofType('fallback_served')[0].reason, 'unavailable');
  });

  it('repairs invalid output once and returns the repaired reply', async () => {
    const { gateway, provider, events } = buildGateway([
      { kind: 'invalid', data: { message: 'ok', tone: 'shouty' } },
      { kind: 'valid', data: { message: 'Use your fingers to count on.', tone: 'cheerful' } },
    ]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(result.source, 'model');
    assert.equal(result.data.tone, 'cheerful');
    assert.equal(provider.callCount, 2);
    assert.equal(events.ofType('schema_rejected').length, 1);
    assert.equal(events.ofType('repair_retry').length, 1);
    // The repair turn restates the shape without quoting the rejected text.
    const repairMessages = provider.calls[1].messages;
    const repairTurn = repairMessages[repairMessages.length - 1].content;
    assert.match(repairTurn, /JSON only/);
    assert.doesNotMatch(repairTurn, /shouty/);
  });

  it('falls back after a second invalid reply and never retries more than once', async () => {
    const { gateway, provider, events } = buildGateway([
      { kind: 'invalid', data: 'not even an object' },
      { kind: 'invalid', data: { message: 'x' } },
    ]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'invalid-output');
    assert.equal(provider.callCount, 2);
    assert.equal(events.ofType('repair_retry').length, 1);
  });

  it('blocks unsafe output immediately, without a repair attempt', async () => {
    const { gateway, provider, events } = buildGateway([
      { kind: 'valid', data: { message: 'Ask a grown-up at www.help.com', tone: 'gentle' } },
    ]);

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'unsafe-output');
    assert.equal(provider.callCount, 1);
    const blocked = events.ofType('safety_block');
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].detail ?? '', /url/);
    // The audit trail records rule ids, never the text we refused to show.
    assert.doesNotMatch(JSON.stringify(events.events), /help\.com/);
  });

  it('treats a caller rejection as repairable, then falls back', async () => {
    const { gateway, provider, events } = buildGateway([
      { kind: 'valid', data: { message: 'The answer is five.', tone: 'gentle' } },
      { kind: 'valid', data: { message: 'It is still five.', tone: 'gentle' } },
    ]);

    const result = await gateway.generate(nudgeRequest(), {
      fallback: FALLBACK,
      accept: (data) =>
        data.message.includes('five') ? { ok: false, reason: 'leaks the answer' } : { ok: true },
    });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'rejected-output');
    assert.equal(provider.callCount, 2);
    assert.equal(events.ofType('output_rejected').length, 1);
  });

  it('serves a second identical request from cache without calling the provider', async () => {
    const cache = new MemoryCacheStore();
    const { gateway, provider } = buildGateway(
      [{ kind: 'valid', data: { message: 'Count on your fingers.', tone: 'gentle' } }],
      { cache },
    );

    const first = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });
    const second = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(first.source, 'model');
    assert.equal(first.cached, false);
    assert.equal(second.source, 'cache');
    assert.equal(second.cached, true);
    assert.deepEqual(second.data, first.data);
    assert.equal(provider.callCount, 1);
    assert.equal(cache.size, 1);
  });

  it('misses the cache when the prompt version, schema version or prompt text changes', async () => {
    const cache = new MemoryCacheStore();
    const { gateway, provider } = buildGateway(
      [{ kind: 'valid', data: { message: 'Count on your fingers.', tone: 'gentle' } }],
      { cache },
    );

    await gateway.generate(nudgeRequest(), { fallback: FALLBACK });
    assert.equal(provider.callCount, 1);

    await gateway.generate(nudgeRequest({ promptVersion: 'nudge.v2' }), { fallback: FALLBACK });
    assert.equal(provider.callCount, 2);

    await gateway.generate(
      nudgeRequest({ schema: { ...NUDGE_SCHEMA, version: 'v2' } }),
      { fallback: FALLBACK },
    );
    assert.equal(provider.callCount, 3);

    await gateway.generate(
      nudgeRequest({
        messages: [
          { role: 'system', content: 'Encourage the child.' },
          { role: 'user', content: 'Question: 4 add 1' },
        ],
      }),
      { fallback: FALLBACK },
    );
    assert.equal(provider.callCount, 4);
    assert.equal(cache.size, 4);
  });

  it('expires cached entries and never caches a fallback', async () => {
    const cache = new MemoryCacheStore();
    let clock = 1_000;
    const { gateway, provider } = buildGateway(
      [
        { kind: 'valid', data: { message: 'Count on your fingers.', tone: 'gentle' } },
        { kind: 'timeout' },
      ],
      { cache, cacheTtlMs: 60_000, now: () => clock },
    );

    await gateway.generate(nudgeRequest(), { fallback: FALLBACK });
    clock += 60_001;

    const afterExpiry = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(afterExpiry.source, 'fallback');
    assert.equal(provider.callCount, 2);
    // The fallback was served but not stored, so a later healthy call is not
    // poisoned by it.
    assert.equal(cache.size, 1);
  });

  it('ignores a cached entry that would no longer pass screening', async () => {
    const cache = new MemoryCacheStore();
    const { gateway, provider } = buildGateway(
      [{ kind: 'valid', data: { message: 'Count on your fingers.', tone: 'gentle' } }],
      { cache },
    );

    await gateway.generate(nudgeRequest(), { fallback: FALLBACK });
    const [key] = cache.keys;
    cache.set(key, {
      value: JSON.stringify({ message: 'Email me at helper@example.com', tone: 'gentle' }),
      createdAt: Date.now(),
    });

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.notEqual(result.source, 'cache');
    assert.equal(provider.callCount, 2);
  });

  it('falls back when no route is configured for the model class', async () => {
    const events = new MemorySafetyEventSink();
    const gateway = new AiGateway({ routes: {}, events });

    const result = await gateway.generate(nudgeRequest(), { fallback: FALLBACK });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fallbackReason, 'no-route');
  });

  it('refuses a cloud route unless cloud is enabled and the data is de-identified', async () => {
    const provider = new FakeProvider([
      { kind: 'valid', data: { message: 'Count on your fingers.', tone: 'gentle' } },
    ]);
    const events = new MemorySafetyEventSink();
    const routes = {
      'cloud-fast': { providerId: 'cloud', model: 'cloud-model', provider, cloud: true },
    };

    const disabled = new AiGateway({ routes, events });
    const denied = await disabled.generate(
      nudgeRequest({ modelClass: 'cloud-fast', dataClassification: 'de-identified' }),
      { fallback: FALLBACK },
    );
    assert.equal(denied.fallbackReason, 'route-denied');

    const enabled = new AiGateway({ routes, events, allowCloud: true });
    const stillDenied = await enabled.generate(
      nudgeRequest({ modelClass: 'cloud-fast', dataClassification: 'family-private' }),
      { fallback: FALLBACK },
    );
    assert.equal(stillDenied.fallbackReason, 'route-denied');

    const allowed = await enabled.generate(
      nudgeRequest({ modelClass: 'cloud-fast', dataClassification: 'de-identified' }),
      { fallback: FALLBACK },
    );
    assert.equal(allowed.source, 'model');
    assert.equal(provider.callCount, 1);
    assert.equal(events.ofType('route_denied').length, 2);
  });

  it('reports provider health per model class', async () => {
    const gateway = new AiGateway({
      routes: {
        'local-fast': {
          providerId: 'fake',
          model: 'fake-model',
          provider: new FakeProvider([{ kind: 'timeout' }], { available: false }),
        },
      },
    });

    assert.deepEqual(await gateway.health(), {
      'local-fast': { available: false, detail: 'scripted as unavailable' },
    });
  });
});
