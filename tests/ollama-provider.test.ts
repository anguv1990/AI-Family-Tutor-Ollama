import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OllamaProvider } from '../server/ai/providers/ollama';
import type { Schema } from '../server/ai/schema';
import { AiProviderError, type StructuredRequest } from '../server/ai/types';

type Hint = { hint: string };

const SCHEMA: Schema<Hint> = {
  name: 'hint',
  version: 'v1',
  fields: { hint: { kind: 'string', maxLength: 120 } },
};

const REQUEST: StructuredRequest<Hint> = {
  task: 'hint',
  promptVersion: 'hint.v1',
  messages: [{ role: 'user', content: 'Question: 2 add 3' }],
  schema: SCHEMA,
  modelClass: 'local-fast',
  temperature: 0.2,
  maxOutputTokens: 60,
  dataClassification: 'family-private',
};

type Recorded = { url: string; init: RequestInit };

function stubFetch(handler: (call: Recorded, index: number) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function connectionRefused(): Error {
  const error = new TypeError('fetch failed');
  (error as Error & { cause?: { code: string } }).cause = { code: 'ECONNREFUSED' };
  return error;
}

describe('Ollama provider', () => {
  it('normalises a non-streaming chat reply and sends the model options', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse({ message: { content: '{"hint":"Count on your fingers."}' } }),
    );
    const provider = new OllamaProvider({ fetchImpl, model: 'test-model', baseUrl: 'http://x:1/' });

    const response = await provider.generateStructured(REQUEST);

    assert.deepEqual(response.data, { hint: 'Count on your fingers.' });
    assert.equal(response.provider, 'ollama');
    assert.equal(response.model, 'test-model');
    assert.equal(calls[0].url, 'http://x:1/api/chat');
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.stream, false);
    assert.equal(body.format, 'json');
    assert.equal(body.options.temperature, 0.2);
    assert.equal(body.options.num_predict, 60);
  });

  it('accepts the generate-endpoint response field and strips code fences', async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse({ response: 'Sure!\n```json\n{"hint":"Count on."}\n```' }),
    );
    const provider = new OllamaProvider({ fetchImpl });

    assert.deepEqual((await provider.generateStructured(REQUEST)).data, { hint: 'Count on.' });
  });

  it('reports a timeout after exhausting retries', async () => {
    const sleeps: number[] = [];
    const { fetchImpl, calls } = stubFetch(() => {
      throw abortError();
    });
    const provider = new OllamaProvider({
      fetchImpl,
      retries: 2,
      backoffMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await assert.rejects(
      () => provider.generateStructured(REQUEST),
      (error: AiProviderError) => error.reason === 'timeout',
    );
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [100, 200]); // exponential backoff
  });

  it('retries a transport failure and succeeds on the second attempt', async () => {
    const { fetchImpl, calls } = stubFetch((_call, index) =>
      index === 0 ? jsonResponse({ error: 'boom' }, 500) : jsonResponse({ response: '{"hint":"Try again."}' }),
    );
    const provider = new OllamaProvider({ fetchImpl, sleep: async () => {} });

    assert.deepEqual((await provider.generateStructured(REQUEST)).data, { hint: 'Try again.' });
    assert.equal(calls.length, 2);
  });

  it('treats a missing model as unavailable and does not retry it', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse({ error: 'model not found' }, 404));
    const provider = new OllamaProvider({ fetchImpl, retries: 2, sleep: async () => {} });

    await assert.rejects(
      () => provider.generateStructured(REQUEST),
      (error: AiProviderError) => error.reason === 'unavailable',
    );
    assert.equal(calls.length, 1);
  });

  it('treats a refused connection as unavailable rather than a transport blip', async () => {
    const { fetchImpl, calls } = stubFetch(() => {
      throw connectionRefused();
    });
    const provider = new OllamaProvider({ fetchImpl, retries: 2, sleep: async () => {} });

    await assert.rejects(
      () => provider.generateStructured(REQUEST),
      (error: AiProviderError) => error.reason === 'unavailable',
    );
    assert.equal(calls.length, 1);
  });

  it('rejects a reply that is not JSON', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ message: { content: 'I am not JSON' } }));
    const provider = new OllamaProvider({ fetchImpl, sleep: async () => {} });

    await assert.rejects(
      () => provider.generateStructured(REQUEST),
      (error: AiProviderError) => error.reason === 'invalid-output',
    );
  });

  it('health-checks the daemon and the pinned model', async () => {
    const installed = new OllamaProvider({
      model: 'test-model',
      fetchImpl: stubFetch(() => jsonResponse({ models: [{ name: 'test-model' }] })).fetchImpl,
    });
    assert.deepEqual(await installed.healthCheck(), { available: true });

    const missing = new OllamaProvider({
      model: 'test-model',
      fetchImpl: stubFetch(() => jsonResponse({ models: [{ name: 'other' }] })).fetchImpl,
    });
    assert.deepEqual(await missing.healthCheck(), {
      available: false,
      detail: 'model test-model is not installed',
    });

    const down = new OllamaProvider({
      fetchImpl: stubFetch(() => {
        throw connectionRefused();
      }).fetchImpl,
    });
    assert.deepEqual(await down.healthCheck(), { available: false, detail: 'unavailable' });
  });
});
