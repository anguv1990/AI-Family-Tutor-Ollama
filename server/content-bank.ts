/**
 * The adult-reviewed Reception Maths question bank.
 *
 * Every template is written out rather than generated, because "adult-reviewed"
 * has to mean a person read this list. Constraints that hold for the whole bank
 * and are enforced by tests in `tests/content-bank.test.ts`:
 *
 * - Exactly one unambiguous answer, always a whole number from 0 to 10, so the
 *   child can answer by tapping a number rather than typing.
 * - Prompts read sensibly aloud, because they are spoken by the browser. No
 *   emoji or symbols that a speech engine would either skip or read out as the
 *   answer.
 * - Difficulty 1 to 3, mapping to the new/learning/secure mastery levels.
 * - `sequence` is the teaching order within a difficulty band; selection uses it
 *   as the tie-break so the child meets the friendliest question in the band
 *   first, and so selection stays reproducible.
 * - At least 20 enabled templates per skill, spread across all three
 *   difficulties, so a session ends by the stopping rule rather than by running
 *   out of content.
 */

export type TemplateSeed = {
  id: string;
  prompt: string;
  correctAnswer: string;
  difficulty: 1 | 2 | 3;
  sequence: number;
};

export type SkillSeed = {
  id: string;
  title: string;
  curriculumVersion: string;
  source: string;
  licence: string;
  templates: TemplateSeed[];
};

const ORIGINAL = 'AI Family Tutor original content';
const LICENCE = 'CC0-1.0';

/** Ordered [a, b] addend pairs. Difficulty follows the total: <=3, 4, then 5. */
const ADDITION_PAIRS: Array<[number, number]> = [
  [1, 1], [1, 2], [2, 1], [1, 0], [0, 1], [2, 0], [0, 2], [3, 0], [0, 3], [0, 0],
  [2, 2], [3, 1], [1, 3], [4, 0], [0, 4],
  [3, 2], [2, 3], [4, 1], [1, 4], [5, 0], [0, 5],
];

const additionTemplates: TemplateSeed[] = ADDITION_PAIRS.map(
  ([a, b], index) => {
    const total = a + b;
    return {
      id: `addition-${a}-plus-${b}`,
      prompt: `What is ${a} + ${b}?`,
      correctAnswer: String(total),
      difficulty: total <= 3 ? 1 : total === 4 ? 2 : 3,
      sequence: index + 1,
    };
  },
);

/**
 * Counting is spoken as a run of numbers with the next one missing. Counting
 * back is treated as harder than counting on at the same size, which is why no
 * backward template sits at difficulty 1.
 */
const COUNTING_RUNS: Array<{ from: number[]; difficulty: 1 | 2 | 3 }> = [
  { from: [1, 2], difficulty: 1 },
  { from: [2, 3], difficulty: 1 },
  { from: [3, 4], difficulty: 1 },
  { from: [1, 2, 3], difficulty: 1 },
  { from: [2, 3, 4], difficulty: 1 },
  { from: [3, 4, 5], difficulty: 2 },
  { from: [4, 5, 6], difficulty: 2 },
  { from: [5, 6, 7], difficulty: 2 },
  { from: [6, 7, 8], difficulty: 3 },
  { from: [7, 8, 9], difficulty: 3 },
  { from: [3, 2], difficulty: 2 },
  { from: [4, 3], difficulty: 2 },
  { from: [5, 4], difficulty: 2 },
  { from: [3, 2, 1], difficulty: 2 },
  { from: [4, 3, 2], difficulty: 2 },
  { from: [5, 4, 3], difficulty: 2 },
  { from: [6, 5, 4], difficulty: 3 },
  { from: [7, 6, 5], difficulty: 3 },
  { from: [8, 7, 6], difficulty: 3 },
  { from: [9, 8, 7], difficulty: 3 },
  { from: [10, 9, 8], difficulty: 3 },
];

const countingTemplates: TemplateSeed[] = COUNTING_RUNS.map(
  ({ from, difficulty }, index) => {
    const step = from[1] - from[0];
    const next = from[from.length - 1] + step;
    const direction = step > 0 ? 'on' : 'back';
    return {
      id: `count-${direction}-${from.join('-')}`,
      prompt: `Count ${direction}. ${from.join(', ')}. What comes next?`,
      correctAnswer: String(next),
      difficulty,
      sequence: index + 1,
    };
  },
);

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
];

/**
 * Recognition is the child hearing a number and finding the numeral, plus
 * comparing two numerals. Both work for a child who cannot yet read words.
 */
const RECOGNITION_NUMBERS: Array<[number, 1 | 2 | 3]> = [
  [1, 1], [2, 1], [3, 1], [0, 1],
  [4, 2], [5, 2], [6, 2], [7, 2],
  [8, 3], [9, 3], [10, 3],
];

const COMPARISONS: Array<{
  kind: 'bigger' | 'smaller';
  pair: [number, number];
  difficulty: 1 | 2 | 3;
}> = [
  { kind: 'bigger', pair: [1, 3], difficulty: 1 },
  { kind: 'smaller', pair: [2, 4], difficulty: 1 },
  { kind: 'bigger', pair: [2, 5], difficulty: 2 },
  { kind: 'bigger', pair: [4, 7], difficulty: 2 },
  { kind: 'smaller', pair: [5, 3], difficulty: 2 },
  { kind: 'smaller', pair: [7, 4], difficulty: 2 },
  { kind: 'bigger', pair: [3, 8], difficulty: 3 },
  { kind: 'bigger', pair: [6, 9], difficulty: 3 },
  { kind: 'smaller', pair: [10, 6], difficulty: 3 },
  { kind: 'smaller', pair: [9, 8], difficulty: 3 },
];

const recognitionTemplates: TemplateSeed[] = [
  ...RECOGNITION_NUMBERS.map(([value, difficulty], index) => ({
    id: `number-tap-${value}`,
    prompt: `Tap the number ${NUMBER_WORDS[value]}.`,
    correctAnswer: String(value),
    difficulty,
    sequence: index + 1,
  })),
  ...COMPARISONS.map(({ kind, pair, difficulty }, index) => ({
    id: `number-${kind}-${pair[0]}-${pair[1]}`,
    prompt: `Tap the ${kind} number. ${pair[0]} or ${pair[1]}.`,
    correctAnswer: String(
      kind === 'bigger' ? Math.max(...pair) : Math.min(...pair),
    ),
    difficulty,
    sequence: RECOGNITION_NUMBERS.length + index + 1,
  })),
];

export const DEFAULT_SKILL_ID = 'reception.addition-within-5';

export const receptionMathsBank: SkillSeed[] = [
  {
    id: DEFAULT_SKILL_ID,
    title: 'Addition within 5',
    curriculumVersion: 'reception-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: additionTemplates,
  },
  {
    id: 'reception.counting-to-10',
    title: 'Counting to 10',
    curriculumVersion: 'reception-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: countingTemplates,
  },
  {
    id: 'reception.number-recognition',
    title: 'Number recognition to 10',
    curriculumVersion: 'reception-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: recognitionTemplates,
  },
];
