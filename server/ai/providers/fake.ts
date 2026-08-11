import { parseJsonObject } from '../schema';
import {
  AiProviderError,
  type AiProvider,
  type StructuredRequest,
  type StructuredResponse,
} from '../types';

/**
 * A scripted, deterministic provider. This is the harness that makes every
 * model-assisted behaviour testable with no Ollama and no network: the whole
 * Day 9 exit check (success, timeout, invalid output, unavailable model) is a
 * script, and so is the repair-on-retry case.
 *
 * A `timeout` step throws immediately rather than actually waiting. Tests need
 * the *behaviour* of a timeout, not its latency.
 */

export type FakeStep =
  | { kind: 'valid'; data: unknown }
  /** Any shape the schema will reject, including a non-object. */
  | { kind: 'invalid'; data: unknown }
  /** Raw text as a small local model would emit it — fences, prose and all. */
  | { kind: 'text'; text: string }
  | { kind: 'timeout' }
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'transport'; detail?: string };

export type FakeCall = {
  task: string;
  promptVersion: string;
  messages: Array<{ role: string; content: string }>;
};

export type FakeProviderOptions = {
  name?: string;
  model?: string;
  latencyMs?: number;
  available?: boolean;
};

export class FakeProvider implements AiProvider {
  readonly calls: FakeCall[] = [];
  private index = 0;

  constructor(
    private readonly script: readonly FakeStep[],
    private readonly options: FakeProviderOptions = {},
  ) {}

  /** Calls beyond the script repeat its last step, so cache tests can assert
   * "the provider was not called again" without scripting spare steps. */
  private next(): FakeStep {
    if (this.script.length === 0) {
      throw new Error('FakeProvider was called with an empty script');
    }
    const step = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    return step;
  }

  get callCount(): number {
    return this.index;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls.push({
      task: request.task,
      promptVersion: request.promptVersion,
      messages: request.messages.map((message) => ({ ...message })),
    });

    const step = this.next();
    switch (step.kind) {
      case 'timeout':
        throw new AiProviderError('timeout', 'fake provider timed out');
      case 'unavailable':
        throw new AiProviderError('unavailable', step.detail ?? 'fake model is not installed');
      case 'transport':
        throw new AiProviderError('transport', step.detail ?? 'fake transport failure');
      case 'text': {
        const parsed = parseJsonObject(step.text);
        if (parsed === undefined) {
          throw new AiProviderError('invalid-output', 'fake provider returned unparsable text');
        }
        return this.respond<T>(parsed);
      }
      case 'valid':
      case 'invalid':
        return this.respond<T>(step.data);
    }
  }

  async healthCheck(): Promise<{ available: boolean; detail?: string }> {
    const available = this.options.available ?? true;
    return available ? { available } : { available, detail: 'scripted as unavailable' };
  }

  // The cast is the point of a provider: raw output claims to be T, and the
  // gateway is what actually proves it.
  private respond<T>(data: unknown): StructuredResponse<T> {
    return {
      data: data as T,
      provider: this.options.name ?? 'fake',
      model: this.options.model ?? 'fake-model',
      latencyMs: this.options.latencyMs ?? 0,
      cached: false,
    };
  }
}
