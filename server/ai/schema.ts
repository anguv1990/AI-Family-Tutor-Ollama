/**
 * A hand-rolled structural validator for the narrow shapes we exchange with a
 * model.
 *
 * DEVIATION from `architecture.md`, recorded deliberately: that document says
 * the gateway validates with Zod. Zod is not a dependency of this project and
 * the local-first MVP stays install-light and offline-friendly, so the two or
 * three tiny object shapes we actually need are described here instead. The
 * contract the rest of the app relies on is unchanged — the gateway still
 * validates every provider reply before anything reaches a child view. Swapping
 * this file for Zod later is a local change behind `validate()`.
 */

export type FieldSpec =
  | { kind: 'string'; minLength?: number; maxLength?: number; pattern?: RegExp }
  | { kind: 'integer'; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: readonly string[] };

export type Schema<T> = {
  name: string;
  // Bumping this invalidates every cached response for the schema, so a shape
  // or meaning change can never be served from stale cache.
  version: string;
  fields: { readonly [K in keyof T]-?: FieldSpec };
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function checkField(spec: FieldSpec, raw: unknown): string[] {
  switch (spec.kind) {
    case 'string': {
      if (typeof raw !== 'string') return ['expected a string'];
      const errors: string[] = [];
      if (spec.minLength !== undefined && raw.trim().length < spec.minLength) {
        errors.push(`shorter than ${spec.minLength} characters`);
      }
      if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
        errors.push(`longer than ${spec.maxLength} characters`);
      }
      if (spec.pattern !== undefined && !spec.pattern.test(raw)) {
        errors.push('does not match the required pattern');
      }
      return errors;
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        return ['expected a whole number'];
      }
      const errors: string[] = [];
      if (spec.min !== undefined && raw < spec.min) errors.push(`below ${spec.min}`);
      if (spec.max !== undefined && raw > spec.max) errors.push(`above ${spec.max}`);
      return errors;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? [] : ['expected true or false'];
    case 'enum':
      return typeof raw === 'string' && spec.values.includes(raw)
        ? []
        : [`expected one of: ${spec.values.join(', ')}`];
  }
}

export function validate<T>(schema: Schema<T>, input: unknown): ValidationResult<T> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['expected a JSON object'] };
  }

  const record = input as Record<string, unknown>;
  const errors: string[] = [];
  const value: Record<string, unknown> = {};

  for (const key of Object.keys(schema.fields) as Array<keyof T & string>) {
    const fieldErrors = checkField(schema.fields[key], record[key]);
    if (fieldErrors.length > 0) {
      errors.push(...fieldErrors.map((error) => `${key}: ${error}`));
      continue;
    }
    // Only declared fields are copied. A model that volunteers extra keys
    // cannot smuggle them past the gateway and into a child view.
    value[key] = record[key];
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as T };
}

/** A compact, deterministic shape description to embed in a prompt. */
export function describeSchema<T>(schema: Schema<T>): string {
  const fields = (Object.keys(schema.fields) as Array<keyof T & string>).map((key) => {
    const spec = schema.fields[key];
    switch (spec.kind) {
      case 'string': {
        const limit = spec.maxLength === undefined ? '' : ` (max ${spec.maxLength} characters)`;
        return `"${key}": string${limit}`;
      }
      case 'integer':
        return `"${key}": whole number`;
      case 'boolean':
        return `"${key}": true or false`;
      case 'enum':
        return `"${key}": one of ${spec.values.map((v) => `"${v}"`).join(' | ')}`;
    }
  });
  return `{ ${fields.join(', ')} }`;
}

/**
 * Best-effort extraction of one JSON object from a model reply. Providers use
 * this because small local models routinely wrap JSON in prose or code fences;
 * the result is still validated by the gateway before anyone sees it.
 */
export function parseJsonObject(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
