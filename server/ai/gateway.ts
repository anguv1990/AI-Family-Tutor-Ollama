import { cacheKey, type CacheStore } from './cache';
import type { SafetyEvent, SafetyEventSink, SafetyEventType } from './events';
import { describeSchema, validate } from './schema';
import { screenStructuredValue, type ScreeningOptions } from './safety';
import {
  AiProviderError,
  type AiProvider,
  type DataClassification,
  type ModelClass,
  type StructuredRequest,
} from './types';

/**
 * The AI gateway: the only door between the tutoring app and any model.
 *
 * Guarantees the rest of the app relies on:
 *  - every reply is validated against the requested schema;
 *  - one repair retry, then a safe deterministic fallback;
 *  - every fallback, rejection and block raises a parent-visible event;
 *  - raw model text never escapes — callers only ever see a validated,
 *    screened value of their own declared type, or their own fallback.
 *
 * It owns no persistence. The cache and event sink are injected ports.
 */

export type Route = {
  providerId: string;
  model: string;
  provider: AiProvider;
  /** Cloud routes are gated on the allow-cloud switch and data classification. */
  cloud?: boolean;
};

export type GatewayConfig = {
  routes: Partial<Record<ModelClass, Route>>;
  cache?: CacheStore;
  events?: SafetyEventSink;
  /** Cloud routes stay off unless a deployment explicitly enables them. */
  allowCloud?: boolean;
  cloudAllowedClassification?: DataClassification;
  cacheTtlMs?: number;
  screening?: Partial<ScreeningOptions>;
  now?: () => number;
};

export type FallbackReason =
  | 'timeout'
  | 'unavailable'
  | 'transport'
  | 'invalid-output'
  | 'unsafe-output'
  | 'rejected-output'
  | 'no-route'
  | 'route-denied';

export type AcceptResult = { ok: true } | { ok: false; reason: string };

export type GenerateOptions<T> = {
  /** Served whenever the model cannot be trusted. Required, by design. */
  fallback: T;
  /**
   * Caller-specific acceptance beyond the schema (e.g. "a hint must not contain
   * the answer"). A rejection is repaired once like a schema failure.
   */
  accept?: (data: T) => AcceptResult;
  cacheable?: boolean;
  sessionId?: string;
};

export type GatewayResult<T> = {
  data: T;
  source: 'model' | 'cache' | 'fallback';
  provider: string;
  model: string;
  latencyMs: number;
  cached: boolean;
  promptVersion: string;
  fallbackReason?: FallbackReason;
};

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class AiGateway {
  private readonly now: () => number;

  constructor(private readonly config: GatewayConfig) {
    this.now = config.now ?? Date.now;
  }

  async health(): Promise<Record<string, { available: boolean; detail?: string }>> {
    const entries = await Promise.all(
      Object.entries(this.config.routes).map(async ([modelClass, route]) => {
        if (!route) return [modelClass, { available: false, detail: 'no route' }] as const;
        try {
          return [modelClass, await route.provider.healthCheck()] as const;
        } catch (error) {
          return [
            modelClass,
            { available: false, detail: error instanceof Error ? error.name : 'unknown' },
          ] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }

  async generate<T>(
    request: StructuredRequest<T>,
    options: GenerateOptions<T>,
  ): Promise<GatewayResult<T>> {
    const startedAt = this.now();
    const route = this.config.routes[request.modelClass];

    if (!route) {
      return this.fallback(request, options, 'no-route', 'none', 'none', startedAt);
    }

    // Routing policy: a cloud route is only reachable when the deployment has
    // opted in *and* the payload's classification is permitted. Denial falls
    // back to a template; it never quietly retries on another provider.
    if (route.cloud) {
      const allowedClassification =
        this.config.cloudAllowedClassification ?? 'de-identified';
      if (!this.config.allowCloud || request.dataClassification !== allowedClassification) {
        return this.fallback(
          request,
          options,
          'route-denied',
          route.providerId,
          route.model,
          startedAt,
          `classification=${request.dataClassification}`,
        );
      }
    }

    const cacheable = options.cacheable !== false && this.config.cache !== undefined;
    const key = cacheable ? cacheKey(route.providerId, route.model, request) : undefined;

    if (key !== undefined) {
      const cached = this.readCache(request, options, key);
      if (cached !== undefined) {
        return {
          data: cached,
          source: 'cache',
          provider: route.providerId,
          model: route.model,
          latencyMs: this.now() - startedAt,
          cached: true,
          promptVersion: request.promptVersion,
        };
      }
    }

    let attemptRequest = request;
    let failure: { reason: FallbackReason; detail: string } | undefined;

    // At most two provider calls: the original and one repair.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let raw: unknown;
      try {
        const response = await route.provider.generateStructured(attemptRequest);
        raw = response.data;
      } catch (error) {
        const reason: FallbackReason =
          error instanceof AiProviderError ? error.reason : 'transport';
        // Transport-level failures are not repairable by re-prompting.
        return this.fallback(
          request,
          options,
          reason,
          route.providerId,
          route.model,
          startedAt,
          error instanceof Error ? error.name : 'unknown',
        );
      }

      // Re-validated here even if the provider claims structured output: the
      // gateway, not the vendor, is the authority on shape.
      const validation = validate(request.schema, raw);
      const accepted = validation.ok
        ? options.accept?.(validation.value) ?? { ok: true as const }
        : { ok: true as const };

      if (validation.ok && accepted.ok) {
        const screening = screenStructuredValue(validation.value, this.config.screening);
        if (!screening.allowed) {
          // Screening failures are never repaired: a model that produced unsafe
          // text once does not get a second try at the child view.
          const violations = screening.violations.join(',');
          this.record(request, options, 'safety_block', route, 'unsafe-output', {
            detail: violations,
          });
          return this.fallback(
            request,
            options,
            'unsafe-output',
            route.providerId,
            route.model,
            startedAt,
            violations,
          );
        }

        if (key !== undefined) {
          this.config.cache?.set(key, {
            value: JSON.stringify(validation.value),
            createdAt: this.now(),
          });
        }

        return {
          data: validation.value,
          source: 'model',
          provider: route.providerId,
          model: route.model,
          latencyMs: this.now() - startedAt,
          cached: false,
          promptVersion: request.promptVersion,
        };
      }

      failure = validation.ok
        ? { reason: 'rejected-output', detail: accepted.ok ? '' : accepted.reason }
        : { reason: 'invalid-output', detail: validation.errors.join('; ') };

      if (attempt === 0) {
        this.record(
          request,
          options,
          failure.reason === 'invalid-output' ? 'schema_rejected' : 'output_rejected',
          route,
          failure.reason,
          { detail: failure.detail },
        );
        this.record(request, options, 'repair_retry', route, failure.reason);
        attemptRequest = withRepairInstruction(request, failure.detail);
      }
    }

    return this.fallback(
      request,
      options,
      failure?.reason ?? 'invalid-output',
      route.providerId,
      route.model,
      startedAt,
      failure?.detail,
    );
  }

  /**
   * Cached values are re-validated and re-screened on read. The cache is shared
   * mutable storage, so trusting it would be a way around the gateway's own
   * guarantees; a stale, expired or unusable entry is simply a miss.
   */
  private readCache<T>(
    request: StructuredRequest<T>,
    options: GenerateOptions<T>,
    key: string,
  ): T | undefined {
    const entry = this.config.cache?.get(key);
    if (!entry) return undefined;

    const ttl = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (this.now() - entry.createdAt > ttl) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.value);
    } catch {
      return undefined;
    }

    const validation = validate(request.schema, parsed);
    if (!validation.ok) return undefined;
    if (options.accept && !options.accept(validation.value).ok) return undefined;
    if (!screenStructuredValue(validation.value, this.config.screening).allowed) return undefined;
    return validation.value;
  }

  private fallback<T>(
    request: StructuredRequest<T>,
    options: GenerateOptions<T>,
    reason: FallbackReason,
    providerId: string,
    model: string,
    startedAt: number,
    detail?: string,
  ): GatewayResult<T> {
    if (reason === 'route-denied') {
      this.record(request, options, 'route_denied', { providerId, model }, reason, { detail });
    }
    this.record(request, options, 'fallback_served', { providerId, model }, reason, { detail });

    return {
      data: options.fallback,
      source: 'fallback',
      provider: providerId,
      model,
      latencyMs: this.now() - startedAt,
      cached: false,
      promptVersion: request.promptVersion,
      fallbackReason: reason,
    };
  }

  private record<T>(
    request: StructuredRequest<T>,
    options: GenerateOptions<T>,
    type: SafetyEventType,
    route: { providerId: string; model: string },
    reason: string,
    extra: { detail?: string } = {},
  ): void {
    const event: SafetyEvent = {
      type,
      task: request.task,
      promptVersion: request.promptVersion,
      provider: route.providerId,
      model: route.model,
      reason,
      detail: extra.detail,
      sessionId: options.sessionId,
      createdAt: this.now(),
    };
    this.config.events?.record(event);
  }
}

/**
 * The repair turn restates the required shape and the objection. It quotes our
 * own validation errors, never the model's text, so a rogue reply cannot inject
 * instructions into the follow-up prompt.
 */
function withRepairInstruction<T>(
  request: StructuredRequest<T>,
  detail: string,
): StructuredRequest<T> {
  return {
    ...request,
    messages: [
      ...request.messages,
      {
        role: 'user',
        content:
          `Your previous reply was rejected (${detail}). ` +
          `Reply with JSON only, matching exactly: ${describeSchema(request.schema)}. ` +
          'No explanation, no code fences, no extra fields.',
      },
    ],
  };
}
