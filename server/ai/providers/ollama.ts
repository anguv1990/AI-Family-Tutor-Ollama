import { describeSchema, parseJsonObject } from '../schema';
import {
  AiProviderError,
  type AiProvider,
  type StructuredRequest,
  type StructuredResponse,
} from '../types';

/**
 * Ollama adapter. This replaces the pre-gateway `server/model-adapter.ts`,
 * keeping its bounded timeout, retry and exponential backoff but putting them
 * behind the provider-neutral contract, as plan.md requires.
 *
 * It only translates: no prompt policy, no safety decisions, no schema
 * authority. Validation and fallback belong to the gateway.
 */

export type OllamaProviderOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** Retries *after* the first attempt. */
  retries?: number;
  backoffMs?: number;
  /**
   * How long Ollama keeps the model resident after a call, in its own duration
   * format ('30m', '1h', 0 to unload immediately).
   *
   * Measured on an M4 Pro with qwen2.5:7b: a warm hint takes ~580ms, a cold one
   * ~3.8s against a 5s budget. A child asking for a hint after a quiet spell is
   * exactly when the model would have been evicted, so keeping it resident is
   * what keeps the budget honest rather than merely satisfied in a benchmark.
   */
  keepAlive?: string | number;
  /** Injectable for tests; defaults to global fetch and real timers. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type OllamaChatReply = {
  message?: { content?: string };
  /** `/api/generate` shape, normalised here so callers see one thing. */
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

const DEFAULT_BASE_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? process.env.OLLAMA_TIMEOUT_MS ?? 15000);
const DEFAULT_MODEL = process.env.OLLAMA_FAST_MODEL ?? 'llama3.2:3b';

export class OllamaProvider implements AiProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly keepAlive: string | number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? 1;
    this.backoffMs = options.backoffMs ?? 200;
    this.keepAlive = options.keepAlive ?? process.env.OLLAMA_KEEP_ALIVE ?? '30m';
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const body = {
      model: this.model,
      stream: false,
      // Ollama's JSON mode still needs the shape spelled out in the prompt.
      format: 'json',
      keep_alive: this.keepAlive,
      messages: [
        ...request.messages,
        {
          role: 'user' as const,
          content: `Reply with JSON only, matching exactly: ${describeSchema(request.schema)}`,
        },
      ],
      // Adapter options (timeout, retries) are ours; model options are Ollama's.
      options: {
        temperature: request.temperature,
        num_predict: request.maxOutputTokens,
      },
    };

    const startedAt = Date.now();
    let lastError: AiProviderError = new AiProviderError('transport', 'no attempt was made');

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const reply = await this.post('/api/chat', body);
        const text = reply.message?.content ?? reply.response;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new AiProviderError('invalid-output', 'Ollama returned an empty reply');
        }
        const parsed = parseJsonObject(text);
        if (parsed === undefined) {
          throw new AiProviderError('invalid-output', 'Ollama reply was not JSON');
        }
        return {
          data: parsed as T,
          provider: 'ollama',
          model: this.model,
          latencyMs: Date.now() - startedAt,
          inputTokens: reply.prompt_eval_count,
          outputTokens: reply.eval_count,
          cached: false,
        };
      } catch (error) {
        lastError = asProviderError(error);
        // Retrying an unreachable daemon or a missing model just adds latency
        // before the same fallback; only transient failures are worth a retry.
        const retryable = lastError.reason === 'timeout' || lastError.reason === 'transport';
        if (!retryable || attempt === this.retries) break;
        await this.sleep(this.backoffMs * 2 ** attempt);
      }
    }

    throw lastError;
  }

  async healthCheck(): Promise<{ available: boolean; detail?: string }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) return { available: false, detail: `status ${response.status}` };
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const installed = (body.models ?? []).some((entry) => entry.name === this.model);
      return installed
        ? { available: true }
        : { available: false, detail: `model ${this.model} is not installed` };
    } catch (error) {
      return { available: false, detail: asProviderError(error).reason };
    }
  }

  private async post(path: string, body: unknown): Promise<OllamaChatReply> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // 404 from Ollama means the model is not pulled, which is an
      // availability problem rather than a transient transport one.
      const reason = response.status === 404 ? 'unavailable' : 'transport';
      throw new AiProviderError(reason, `Ollama responded ${response.status}`);
    }

    const parsed = (await response.json().catch(() => undefined)) as OllamaChatReply | undefined;
    if (!parsed) throw new AiProviderError('invalid-output', 'Ollama returned unreadable JSON');
    return parsed;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function asProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new AiProviderError('timeout', 'Ollama request timed out');
    }
    // Node reports a refused connection as a TypeError with a cause; from the
    // app's point of view that is simply "Ollama is not running".
    const code = (error as NodeJS.ErrnoException & { cause?: { code?: string } }).cause?.code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return new AiProviderError('unavailable', 'Ollama is not reachable');
    }
    return new AiProviderError('transport', error.message);
  }
  return new AiProviderError('transport', 'unknown Ollama failure');
}
