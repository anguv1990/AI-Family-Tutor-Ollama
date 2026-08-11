import crypto from 'node:crypto';
import type { StructuredRequest } from './types';

/**
 * The gateway's cache port. Deliberately synchronous and storage-free: the
 * caller injects an implementation (SQLite in the app, memory in tests) so this
 * slice opens no database of its own.
 */

export type CacheEntry = { value: string; createdAt: number };

export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }

  get size(): number {
    return this.entries.size;
  }

  get keys(): string[] {
    return [...this.entries.keys()];
  }
}

/**
 * Bump when the *meaning* of a cached entry changes for reasons the key below
 * cannot see (a screening-rule change, say). It invalidates every entry at once.
 */
export const CACHE_KEY_VERSION = 'v1';

/**
 * plan.md requires the key to cover model/version, prompt hash, options and
 * schema/template version, so that a content, safety or pedagogy change cannot
 * reuse stale output.
 */
export function cacheKey<T>(
  providerId: string,
  model: string,
  request: StructuredRequest<T>,
): string {
  const material = JSON.stringify([
    CACHE_KEY_VERSION,
    providerId,
    model,
    request.task,
    request.promptVersion,
    request.schema.name,
    request.schema.version,
    request.modelClass,
    request.temperature,
    request.maxOutputTokens,
    request.dataClassification,
    request.messages.map((message) => [message.role, message.content]),
  ]);
  return crypto.createHash('sha256').update(material).digest('hex');
}
