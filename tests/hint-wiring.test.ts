import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { SqliteCacheStore, SqliteSafetyEventSink } from '../server/ai-stores';
import { AiGateway, FakeProvider, HintService } from '../server/ai';

/**
 * The seam between the tutoring engine and the AI slice. The AI slice is tested
 * on its own; what matters here is that a hint reaches the child through the
 * real HTTP route, that the answer key never leaves with it, and that the
 * SQLite ports behave like the in-memory ones the gateway was tested against.
 */

describe('hint wiring', () => {
  test('falls back to the deterministic hint when no model is wired', async () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'child-a' });

    const result = await tutor.requestHint({ sessionId: session.sessionId });

    assert.equal(result.source, 'fallback');
    assert.ok(result.hint.length > 0);
    database.close();
  });

  test('passes the answer key to the hint port but never returns it', async () => {
    const database = createDatabase(':memory:');
    let seenAnswer: string | undefined;
    const tutor = new TutoringService(database, {
      hints: {
        async getHint(request) {
          seenAnswer = request.correctAnswer;
          return { hint: 'Count on your fingers.', source: 'model' as const };
        },
      },
    });
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'child-b' });

    const result = await tutor.requestHint({ sessionId: session.sessionId });

    assert.ok(seenAnswer, 'the engine must supply the answer key for leak checking');
    assert.deepEqual(Object.keys(result).sort(), ['hint', 'source']);
    database.close();
  });

  test('refuses a hint for an ended session', async () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'child-c' });
    tutor.completeSession({ sessionId: session.sessionId });

    await assert.rejects(
      () => tutor.requestHint({ sessionId: session.sessionId }),
      /Active session not found/,
    );
    database.close();
  });

  test('serves a hint over HTTP without leaking internals', async () => {
    const database = createDatabase(':memory:');
    const gateway = new AiGateway({
      routes: {
        'local-fast': {
          providerId: 'fake',
          model: 'test-model',
          provider: new FakeProvider([
            { kind: 'valid', data: { hint: 'Use your fingers to count on.' } },
          ]),
        },
      },
      cache: new SqliteCacheStore(database),
      events: new SqliteSafetyEventSink(database),
    });
    const tutor = new TutoringService(database, { hints: new HintService(gateway) });
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'child-d' });

    const server = createApp(tutor).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${session.sessionId}/hint`,
      { method: 'POST' },
    );
    const body = (await response.json()) as { hint: string; source: string };

    assert.equal(response.status, 200);
    assert.equal(body.hint, 'Use your fingers to count on.');
    assert.ok(!('correct_answer' in body) && !('correctAnswer' in body));

    server.close();
    database.close();
  });

  test('an unavailable model still answers the child, and tells an adult', async () => {
    const database = createDatabase(':memory:');
    const gateway = new AiGateway({
      routes: {
        'local-fast': {
          providerId: 'ollama',
          model: 'absent-model',
          provider: new FakeProvider([{ kind: 'unavailable' }]),
        },
      },
      events: new SqliteSafetyEventSink(database),
    });
    const tutor = new TutoringService(database, { hints: new HintService(gateway) });
    tutor.seedInitialContent();
    const session = tutor.startSession({ childId: 'child-e' });

    const result = await tutor.requestHint({ sessionId: session.sessionId });
    assert.equal(result.source, 'fallback');
    assert.ok(result.hint.length > 0);

    const events = database
      .prepare('SELECT event_type, reason, detail FROM safety_events')
      .all() as Array<{ event_type: string; reason: string; detail: string | null }>;
    assert.ok(events.length > 0, 'a fallback must be visible to a parent');
    database.close();
  });

  test('the SQLite cache round-trips an entry', () => {
    const database = createDatabase(':memory:');
    const cache = new SqliteCacheStore(database);
    const createdAt = Date.now();

    cache.set('key-1', { value: '{"hint":"ok"}', createdAt });
    const stored = cache.get('key-1');

    assert.equal(stored?.value, '{"hint":"ok"}');
    // Second-resolution storage: close enough for a TTL, not for an equality check.
    assert.ok(Math.abs((stored?.createdAt ?? 0) - createdAt) < 1000);
    assert.equal(cache.get('missing'), undefined);

    cache.set('key-1', { value: '{"hint":"replaced"}', createdAt });
    assert.equal(cache.get('key-1')?.value, '{"hint":"replaced"}');

    assert.equal(cache.clear(), 1);
    assert.equal(cache.get('key-1'), undefined);
    database.close();
  });
});
