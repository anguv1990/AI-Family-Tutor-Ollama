/**
 * The public surface of the AI slice. Everything outside `server/ai/` should
 * import from here, so provider modules stay swappable and no vendor shape
 * leaks into the tutoring engine.
 */

export { AiGateway } from './gateway';
export type {
  AcceptResult,
  FallbackReason,
  GatewayConfig,
  GatewayResult,
  GenerateOptions,
  Route,
} from './gateway';

export { HintService, HINT_PROMPT_VERSION, HINT_SCHEMA, fallbackHintFor, hintLeaksAnswer } from './hint-service';
export type { Hint, HintRequest, HintResult } from './hint-service';

export { CACHE_KEY_VERSION, MemoryCacheStore, cacheKey } from './cache';
export type { CacheEntry, CacheStore } from './cache';

export { MemorySafetyEventSink } from './events';
export type { SafetyEvent, SafetyEventSink, SafetyEventType } from './events';

export {
  DEFAULT_SCREENING_OPTIONS,
  SAFETY_RULES,
  screenChildText,
  screenStructuredValue,
} from './safety';
export type { SafetyRule, ScreeningOptions, ScreeningResult } from './safety';

export { describeSchema, parseJsonObject, validate } from './schema';
export type { FieldSpec, Schema, ValidationResult } from './schema';

export { AiProviderError } from './types';
export type {
  AiFailureReason,
  AiMessage,
  AiProvider,
  AiTask,
  DataClassification,
  ModelClass,
  StructuredRequest,
  StructuredResponse,
} from './types';

export { FakeProvider } from './providers/fake';
export type { FakeCall, FakeProviderOptions, FakeStep } from './providers/fake';

export { OllamaProvider } from './providers/ollama';
export type { OllamaProviderOptions } from './providers/ollama';
