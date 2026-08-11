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

export type YearGroup = 'reception' | 'year3';

/**
 * How the child gives an answer. Reception answers are whole numbers 0-10 and
 * are tapped from a row; Year 3 answers run past 10 and are typed on a keypad.
 * Marking is an exact match on a whole number either way, so this changes the
 * input surface only, never the grading.
 */
export type AnswerEntry = 'tap-0-10' | 'keypad';

export type SkillSeed = {
  id: string;
  title: string;
  yearGroup: YearGroup;
  answerEntry: AnswerEntry;
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

/* --- Year 3 --------------------------------------------------------------
 *
 * UK National Curriculum, Year 3 maths (ages 7-8). The same review rules apply
 * as for Reception, with two deliberate differences:
 *
 * - Answers are whole numbers but not limited to 0-10, so they are typed on a
 *   keypad rather than tapped from a row. Marking stays an exact string match
 *   on a whole number, so nothing about deterministic grading changes.
 * - Prompts may use "times" and "lots of" wording, but still read aloud
 *   cleanly, because read-aloud stays available for a child who wants it.
 *
 * Fraction questions are deliberately framed to have whole-number answers
 * ("one quarter of 20"), so a child never has to type "1/4" and the marker
 * never has to decide whether "0.25" is the same answer.
 */

/** The 3, 4 and 8 times tables are the Year 3 programme of study's explicit requirement. */
const TIMES_TABLE_FACTS: Array<[number, number, 1 | 2 | 3]> = [
  [3, 1, 1], [3, 2, 1], [3, 3, 1], [3, 4, 1], [3, 5, 1], [3, 10, 1], [3, 6, 1],
  [4, 2, 2], [4, 3, 2], [4, 4, 2], [4, 5, 2], [4, 6, 2], [4, 10, 2], [4, 8, 2],
  [8, 2, 3], [8, 3, 3], [8, 4, 3], [8, 5, 3], [8, 6, 3], [8, 7, 3], [8, 8, 3],
];

const timesTableTemplates: TemplateSeed[] = TIMES_TABLE_FACTS.map(
  ([a, b, difficulty], index) => ({
    id: `year3-times-${a}-x-${b}`,
    prompt: `What is ${a} times ${b}?`,
    correctAnswer: String(a * b),
    difficulty,
    sequence: index + 1,
  }),
);

/** [number, operation, difficulty]. Place value to 1000. */
const PLACE_VALUE_STEPS: Array<[number, 'ten-more' | 'ten-less' | 'hundred-more' | 'hundred-less', 1 | 2 | 3]> = [
  [234, 'ten-more', 1], [451, 'ten-more', 1], [126, 'ten-more', 1], [372, 'ten-less', 1],
  [548, 'ten-less', 1], [263, 'hundred-more', 2], [417, 'hundred-more', 2],
  [592, 'hundred-less', 2], [736, 'hundred-less', 2], [895, 'ten-more', 2],
];

const STEP_WORDING: Record<string, { words: string; delta: number }> = {
  'ten-more': { words: '10 more than', delta: 10 },
  'ten-less': { words: '10 less than', delta: -10 },
  'hundred-more': { words: '100 more than', delta: 100 },
  'hundred-less': { words: '100 less than', delta: -100 },
};

/** [number, place, difficulty] — which digit sits in a named column. */
const PLACE_VALUE_DIGITS: Array<[number, 'ones' | 'tens' | 'hundreds', 1 | 2 | 3]> = [
  [347, 'tens', 1], [508, 'hundreds', 2], [692, 'ones', 1],
  [815, 'tens', 2], [473, 'hundreds', 2], [960, 'tens', 3],
];

/** [left, right, 'larger' | 'smaller', difficulty] */
const PLACE_VALUE_COMPARISONS: Array<[number, number, 'larger' | 'smaller', 1 | 2 | 3]> = [
  [245, 254, 'larger', 2], [619, 691, 'smaller', 3], [430, 403, 'larger', 3],
  [777, 787, 'smaller', 3], [250, 205, 'larger', 3],
];

const placeValueTemplates: TemplateSeed[] = [
  ...PLACE_VALUE_STEPS.map(([number, step, difficulty], index) => {
    const { words, delta } = STEP_WORDING[step];
    return {
      id: `year3-place-${step}-${number}`,
      prompt: `What is ${words} ${number}?`,
      correctAnswer: String(number + delta),
      difficulty,
      sequence: index + 1,
    };
  }),
  ...PLACE_VALUE_DIGITS.map(([number, place, difficulty], index) => ({
    id: `year3-place-digit-${place}-${number}`,
    prompt: `In the number ${number}, which digit is in the ${place} column?`,
    correctAnswer: String(
      place === 'ones'
        ? number % 10
        : place === 'tens'
          ? Math.floor(number / 10) % 10
          : Math.floor(number / 100) % 10,
    ),
    difficulty,
    sequence: PLACE_VALUE_STEPS.length + index + 1,
  })),
  ...PLACE_VALUE_COMPARISONS.map(([left, right, kind, difficulty], index) => ({
    id: `year3-place-compare-${left}-${right}`,
    prompt: `Which number is ${kind}, ${left} or ${right}?`,
    correctAnswer: String(kind === 'larger' ? Math.max(left, right) : Math.min(left, right)),
    difficulty,
    sequence: PLACE_VALUE_STEPS.length + PLACE_VALUE_DIGITS.length + index + 1,
  })),
];

/**
 * [left, operator, right, difficulty]. Difficulty 1 adds or subtracts ones and
 * tens with no regrouping; 2 crosses a ten or works in hundreds; 3 regroups.
 */
const CALCULATION_FACTS: Array<[number, '+' | '-', number, 1 | 2 | 3]> = [
  [234, '+', 5, 1], [341, '+', 20, 1], [512, '+', 300, 1], [463, '-', 2, 1],
  [578, '-', 40, 1], [846, '-', 200, 1], [125, '+', 300, 1],
  [237, '+', 8, 2], [456, '+', 70, 2], [389, '+', 40, 2], [624, '-', 8, 2],
  [731, '-', 50, 2], [905, '-', 60, 2], [268, '+', 90, 2],
  [347, '+', 265, 3], [582, '+', 149, 3], [476, '+', 358, 3], [623, '-', 187, 3],
  [741, '-', 296, 3], [800, '-', 435, 3], [555, '+', 278, 3],
];

const calculationTemplates: TemplateSeed[] = CALCULATION_FACTS.map(
  ([left, operator, right, difficulty], index) => ({
    id: `year3-calc-${left}-${operator === '+' ? 'plus' : 'minus'}-${right}`,
    prompt: `What is ${left} ${operator === '+' ? 'add' : 'subtract'} ${right}?`,
    correctAnswer: String(operator === '+' ? left + right : left - right),
    difficulty,
    sequence: index + 1,
  }),
);

/**
 * [numerator, denominator, amount, difficulty]. Every pairing is chosen so the
 * answer is a whole number — a Year 3 child is learning what a fraction of an
 * amount means, not how to type a remainder.
 */
const FRACTION_FACTS: Array<[number, number, number, 1 | 2 | 3]> = [
  [1, 2, 12, 1], [1, 2, 20, 1], [1, 2, 8, 1], [1, 4, 20, 1], [1, 4, 12, 1],
  [1, 3, 18, 1], [1, 3, 9, 1],
  [1, 4, 32, 2], [1, 3, 24, 2], [1, 5, 30, 2], [1, 10, 40, 2], [1, 10, 90, 2],
  [1, 5, 45, 2], [1, 2, 46, 2],
  [3, 4, 20, 3], [2, 3, 18, 3], [3, 4, 16, 3], [2, 5, 30, 3], [3, 10, 40, 3],
  [5, 8, 24, 3], [2, 3, 27, 3],
];

const FRACTION_WORDS: Record<string, string> = {
  '1/2': 'one half',
  '1/3': 'one third',
  '1/4': 'one quarter',
  '1/5': 'one fifth',
  '1/8': 'one eighth',
  '1/10': 'one tenth',
  '2/3': 'two thirds',
  '3/4': 'three quarters',
  '2/5': 'two fifths',
  '3/10': 'three tenths',
  '5/8': 'five eighths',
};

const fractionTemplates: TemplateSeed[] = FRACTION_FACTS.map(
  ([numerator, denominator, amount, difficulty], index) => {
    const words = FRACTION_WORDS[`${numerator}/${denominator}`];
    if (!words) throw new Error(`no spoken wording for ${numerator}/${denominator}`);
    return {
      id: `year3-fraction-${numerator}-${denominator}-of-${amount}`,
      prompt: `What is ${words} of ${amount}?`,
      correctAnswer: String((amount / denominator) * numerator),
      difficulty,
      sequence: index + 1,
    };
  },
);

export const DEFAULT_SKILL_ID = 'reception.addition-within-5';

export const receptionMathsBank: SkillSeed[] = [
  {
    id: DEFAULT_SKILL_ID,
    title: 'Addition within 5',
    yearGroup: 'reception',
    answerEntry: 'tap-0-10',
    curriculumVersion: 'reception-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: additionTemplates,
  },
  {
    id: 'reception.counting-to-10',
    title: 'Counting to 10',
    yearGroup: 'reception',
    answerEntry: 'tap-0-10',
    curriculumVersion: 'reception-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: countingTemplates,
  },
  {
    id: 'reception.number-recognition',
    title: 'Number recognition to 10',
    yearGroup: 'reception',
    answerEntry: 'tap-0-10',
    curriculumVersion: 'reception-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: recognitionTemplates,
  },
  {
    id: 'year3.times-tables',
    title: 'Times tables: 3, 4 and 8',
    yearGroup: 'year3',
    answerEntry: 'keypad',
    curriculumVersion: 'year3-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: timesTableTemplates,
  },
  {
    id: 'year3.place-value-to-1000',
    title: 'Place value to 1000',
    yearGroup: 'year3',
    answerEntry: 'keypad',
    curriculumVersion: 'year3-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: placeValueTemplates,
  },
  {
    id: 'year3.add-and-subtract',
    title: 'Adding and subtracting to 1000',
    yearGroup: 'year3',
    answerEntry: 'keypad',
    curriculumVersion: 'year3-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: calculationTemplates,
  },
  {
    id: 'year3.fractions-of-amounts',
    title: 'Fractions of amounts',
    yearGroup: 'year3',
    answerEntry: 'keypad',
    curriculumVersion: 'year3-maths-v1',
    source: ORIGINAL,
    licence: LICENCE,
    templates: fractionTemplates,
  },
];

/** The skill a child starts on when none is named, per year group. */
export const DEFAULT_SKILL_BY_YEAR_GROUP: Record<YearGroup, string> = {
  reception: DEFAULT_SKILL_ID,
  year3: 'year3.times-tables',
};
