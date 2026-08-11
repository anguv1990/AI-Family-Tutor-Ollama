/**
 * Rule-based screening of model output before it can reach a child view.
 *
 * plan.md requires rule-based screening (an optional local classifier comes
 * later) with a parent-visible safe fallback for blocked output. The rules are a
 * table so a newly observed failure is one row plus one test case, not a new
 * branch in the gateway.
 *
 * This screens *output*, not correctness. Nothing here decides whether an answer
 * is right — that stays deterministic in the tutoring engine.
 */

export type ScreeningOptions = {
  /** Hard cap on child-facing text. Long output is a failure mode in itself. */
  maxLength: number;
  /** Extra characters to allow beyond the default child-safe set. */
  extraAllowedCharacters: string;
};

export const DEFAULT_SCREENING_OPTIONS: ScreeningOptions = {
  maxLength: 240,
  extraAllowedCharacters: '',
};

export type SafetyRule = {
  id: string;
  description: string;
  /** True when the rule is violated and the text must be blocked. */
  violated: (text: string, options: ScreeningOptions) => boolean;
};

// Everything a Reception hint could legitimately need, and nothing else.
// Anything outside this set (emoji, other scripts, markup, control characters)
// is treated as a signal that the model has left the rails.
const ALLOWED_CHARACTERS = "A-Za-z0-9 .,!?'’:;()\\-+=×÷";

const URL_PATTERNS = [
  /[a-z][a-z0-9+.-]*:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]{2,}\.(com|net|org|io|uk|co|me|app|dev|xyz|info|tv)\b/i,
];

const EMAIL_PATTERN = /[a-z0-9._%+-]+\s*(@|\bat\b)\s*[a-z0-9.-]+\.[a-z]{2,}/i;

// Single digits separated by spaces are normal in a counting hint ("1 2 3 4 5"),
// so only grouped or long digit runs count as a phone number.
const PHONE_PATTERNS = [
  /\d{7,}/,
  /\+\d[\d ().-]{6,}\d/,
  /\b\d{3,5}[ .-]\d{3,4}[ .-]\d{3,4}\b/,
];

const CONTACT_REQUEST_PATTERNS = [
  /\b(call|text|message|email|write|dm|whatsapp|facetime|skype)\s+(me|us|him|her|them)\b/i,
  /\b(contact|reach|find|meet|visit|follow|subscribe to)\s+(me|us)\b/i,
  /\b(phone|mobile|telephone|contact)\s*(number|details)\b/i,
  /\bsend\s+(me|us)\b/i,
  /\bsocial media\b/i,
];

const PERSONAL_DATA_PATTERNS = [
  /\b(your|thy)\s+(full\s+)?(name|surname|address|postcode|school|birthday|password|email|phone)\b/i,
  /\bhow old are you\b/i,
  /\bwhere do you (live|go to school)\b/i,
  /\btell me (your|about your|who)\b/i,
  /\bwhat(’|')?s your\b/i,
  /\bwhat is your\b/i,
];

export const SAFETY_RULES: readonly SafetyRule[] = [
  {
    id: 'empty',
    description: 'Output is blank or whitespace only.',
    violated: (text) => text.trim().length === 0,
  },
  {
    id: 'too-long',
    description: 'Output exceeds the length cap for child-facing text.',
    violated: (text, options) => text.length > options.maxLength,
  },
  {
    id: 'url',
    description: 'Output contains a link or web address.',
    violated: (text) => URL_PATTERNS.some((pattern) => pattern.test(text)),
  },
  {
    id: 'email-address',
    description: 'Output contains an email address.',
    violated: (text) => EMAIL_PATTERN.test(text) || text.includes('@'),
  },
  {
    id: 'phone-number',
    description: 'Output contains something shaped like a phone number.',
    violated: (text) => PHONE_PATTERNS.some((pattern) => pattern.test(text)),
  },
  {
    id: 'contact-request',
    description: 'Output asks the child to contact or follow someone.',
    violated: (text) => CONTACT_REQUEST_PATTERNS.some((pattern) => pattern.test(text)),
  },
  {
    id: 'personal-data-request',
    description: 'Output asks the child for personal information.',
    violated: (text) => PERSONAL_DATA_PATTERNS.some((pattern) => pattern.test(text)),
  },
  {
    id: 'disallowed-characters',
    description: 'Output uses characters outside the child-safe allow-list.',
    violated: (text, options) => {
      const escaped = options.extraAllowedCharacters.replace(/[\\\]^-]/g, '\\$&');
      return new RegExp(`[^${ALLOWED_CHARACTERS}${escaped}]`).test(text);
    },
  },
];

export type ScreeningResult = { allowed: true } | { allowed: false; violations: string[] };

export function screenChildText(
  text: string,
  options: Partial<ScreeningOptions> = {},
): ScreeningResult {
  const resolved = { ...DEFAULT_SCREENING_OPTIONS, ...options };
  const violations = SAFETY_RULES.filter((rule) => rule.violated(text, resolved)).map(
    (rule) => rule.id,
  );
  return violations.length === 0 ? { allowed: true } : { allowed: false, violations };
}

/** Screens every string anywhere in a validated structured value. */
export function screenStructuredValue(
  value: unknown,
  options: Partial<ScreeningOptions> = {},
): ScreeningResult {
  const violations = new Set<string>();

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      const result = screenChildText(node, options);
      if (!result.allowed) result.violations.forEach((id) => violations.add(id));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object') {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  };

  walk(value);
  return violations.size === 0 ? { allowed: true } : { allowed: false, violations: [...violations] };
}
