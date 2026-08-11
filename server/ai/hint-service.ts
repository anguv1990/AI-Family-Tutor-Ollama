import type { AiGateway, FallbackReason } from './gateway';
import type { Schema } from './schema';
import type { StructuredRequest } from './types';

/**
 * Optional model-assisted hints.
 *
 * The model gets exactly one job: phrase a nudge. It never marks an answer,
 * never picks the next question and never sets difficulty — those stay
 * deterministic in the tutoring engine, and the schema below makes it
 * structurally impossible for a reply to carry such a decision.
 *
 * Every path ends in a usable hint. If the model is slow, absent, malformed,
 * unsafe or leaks the answer, the child gets the deterministic template and an
 * adult gets an event. The tutoring loop never depends on a model being up.
 */

// Versioned so a wording change cannot be served from cache (plan.md).
export const HINT_PROMPT_VERSION = 'hint.2026-08-11.v1';

export type Hint = { hint: string };

export const HINT_SCHEMA: Schema<Hint> = {
  name: 'hint',
  version: 'v1',
  fields: {
    hint: { kind: 'string', minLength: 4, maxLength: 120 },
  },
};

export type HintRequest = {
  questionPrompt: string;
  skillId: string;
  difficulty: number;
  /** Used only to reject a leaked answer; never sent to the model. */
  correctAnswer: string;
  sessionId?: string;
};

export type HintResult = {
  hint: string;
  source: 'model' | 'cache' | 'fallback';
  fallbackReason?: FallbackReason;
};

const FALLBACK_HINTS: Record<string, string> = {
  'reception.addition-within-5':
    'Hold up fingers for the first number, then count on for the second one.',
  'reception.counting-to-10':
    'Point at each one as you say the numbers out loud, and do not skip any.',
  'reception.number-recognition':
    'Say the numbers out loud in order and stop when you reach the one you need.',
};

const GENERIC_FALLBACK_HINT = 'Take your time, count out loud, and try one small step first.';

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

const SYSTEM_PROMPT = [
  'You help a four-year-old child with Reception maths in a UK school.',
  'Give one short encouraging hint, at most fifteen words, in plain English.',
  'Never give the answer or any part of it. Never say a number that could be the answer.',
  'Do not mark the child right or wrong. Do not ask the child any question.',
  'No links, no names, no emoji, no personal questions.',
].join(' ');

export function fallbackHintFor(skillId: string): string {
  return FALLBACK_HINTS[skillId] ?? GENERIC_FALLBACK_HINT;
}

/**
 * A hint that contains the answer is a failed hint, so this is checked as a
 * gateway acceptance rule: it gets one repair attempt and then falls back.
 *
 * Deliberately blunt — it matches the answer as a standalone digit or number
 * word anywhere in the hint. When the question itself contains the answer
 * ("5 + 0"), an echoing hint is rejected too. Erring towards the template is
 * the cheap mistake; leaking the answer is the expensive one.
 */
export function hintLeaksAnswer(hint: string, correctAnswer: string): boolean {
  const answer = correctAnswer.trim().toLowerCase();
  if (answer.length === 0) return false;

  const candidates = new Set<string>([answer]);
  const numeric = Number(answer);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < NUMBER_WORDS.length) {
    candidates.add(NUMBER_WORDS[numeric]);
  }
  const wordIndex = NUMBER_WORDS.indexOf(answer);
  if (wordIndex >= 0) candidates.add(String(wordIndex));

  const haystack = hint.toLowerCase();
  return [...candidates].some((candidate) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(candidate)}([^a-z0-9]|$)`).test(haystack),
  );
}

export class HintService {
  constructor(private readonly gateway: AiGateway) {}

  async getHint(request: HintRequest): Promise<HintResult> {
    const fallback = fallbackHintFor(request.skillId);

    const structuredRequest: StructuredRequest<Hint> = {
      task: 'hint',
      promptVersion: HINT_PROMPT_VERSION,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          // Only the question text, skill and difficulty go to the model. No
          // child name, age, history or identifiers (plan.md).
          content: [
            `Question: ${request.questionPrompt}`,
            `Skill: ${request.skillId}`,
            `Difficulty: ${request.difficulty} of 3`,
          ].join('\n'),
        },
      ],
      schema: HINT_SCHEMA,
      modelClass: 'local-fast',
      // Low temperature and a tight token cap: a hint is a nudge, not prose,
      // and a cheap call keeps the loop responsive on a small local model.
      temperature: 0.2,
      maxOutputTokens: 60,
      dataClassification: 'family-private',
    };

    const result = await this.gateway.generate(structuredRequest, {
      fallback: { hint: fallback },
      sessionId: request.sessionId,
      accept: (data) =>
        hintLeaksAnswer(data.hint, request.correctAnswer)
          ? { ok: false, reason: 'hint contains the answer' }
          : { ok: true },
    });

    return {
      hint: result.data.hint,
      source: result.source,
      fallbackReason: result.fallbackReason,
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
