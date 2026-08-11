import type { Schema } from './schema';

/**
 * The provider-neutral contract from `architecture.md`. Everything outside
 * `server/ai/providers/` depends on this and never on a vendor API shape.
 */

export type AiTask = 'question-variation' | 'hint' | 'evaluation' | 'parent-summary';

export type ModelClass = 'local-fast' | 'cloud-fast' | 'cloud-reasoning';

export type DataClassification = 'family-private' | 'de-identified';

export type AiMessage = { role: 'system' | 'user'; content: string };

export type StructuredRequest<T> = {
  task: AiTask;
  promptVersion: string;
  messages: AiMessage[];
  // architecture.md types this `object` (a JSON Schema generated from Zod). We
  // carry our own `Schema<T>` descriptor instead — it is still a plain object,
  // but it makes T inferable and carries the version the cache keys on.
  schema: Schema<T>;
  modelClass: ModelClass;
  temperature: number;
  maxOutputTokens: number;
  dataClassification: DataClassification;
};

export type StructuredResponse<T> = {
  data: T; // validated against the requested schema
  provider: string;
  model: string;
  requestId?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cached: boolean;
};

export interface AiProvider {
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
  healthCheck(): Promise<{ available: boolean; detail?: string }>;
}

/**
 * Why a provider call failed, in gateway terms rather than vendor terms. A
 * provider must translate its own errors into one of these so routing and
 * fallback decisions never depend on parsing a vendor error string.
 */
export type AiFailureReason =
  | 'timeout'
  | 'unavailable' // provider or model not reachable/installed
  | 'transport' // reachable but the call failed (HTTP error, bad payload)
  | 'invalid-output'; // reply could not be parsed as JSON at all

export class AiProviderError extends Error {
  constructor(
    readonly reason: AiFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
