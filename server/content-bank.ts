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

/**
 * A picture of the question, for a child who can neither read the prompt nor
 * is listening to it being read.
 *
 * The first observed sitting settled this: a four-year-old ignored the spoken
 * prompt and simply tapped, which means they were guessing. Text plus audio was
 * two ways of saying the same thing and the child used neither. A picture is a
 * third way that needs no reading and no sound.
 *
 * The prompt text stays exactly as it was — it is what gets read aloud, and
 * what an adult reviews. The visual is an addition, never a replacement.
 *
 *  groups   — countable dots in groups, joined by a plus. 3 + 2 is six dots
 *             the child can actually count.
 *  count    — one group of dots to count.
 *  sequence — a number track with the next place left blank.
 *  numerals — one or more numerals shown large, for matching or comparing.
 */
export type Visual =
  | { kind: 'groups'; groups: number[] }
  | { kind: 'count'; total: number }
  | { kind: 'sequence'; shown: number[] }
  | { kind: 'numerals'; values: number[]; want?: 'bigger' | 'smaller' };

export type TemplateSeed = {
  id: string;
  prompt: string;
  correctAnswer: string;
  difficulty: 1 | 2 | 3;
  sequence: number;
  /** Reception only. Year 3 children read the prompt. */
  visual?: Visual;
};

export type YearGroup = 'reception' | 'year2' | 'year3';

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
  /** The `Modal_data` curriculum skills this was built from, where it was. */
  datasetSkillIds?: string[];
  source: string;
  licence: string;
  templates: TemplateSeed[];
};

const ORIGINAL = 'AI Family Tutor original content';
const DATASET_SOURCE =
  'Built to the bounds in Modal_data/Maths/uk_math_ai_tutor_v1 (UK Maths AI Tutor Dataset v1); questions and answer keys computed deterministically here';
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
      visual: { kind: 'groups' as const, groups: [a, b] },
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
      // The run itself, with the next place left empty for the child to fill.
      visual: { kind: 'sequence' as const, shown: [...from] },
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
    // The numeral itself, large. A child who cannot read the sentence can
    // still match the shape, which is exactly the skill being practised.
    visual: { kind: 'numerals' as const, values: [value] },
  })),
  ...COMPARISONS.map(({ kind, pair, difficulty }, index) => ({
    id: `number-${kind}-${pair[0]}-${pair[1]}`,
    prompt: `Tap the ${kind} number. ${pair[0]} or ${pair[1]}.`,
    correctAnswer: String(
      kind === 'bigger' ? Math.max(...pair) : Math.min(...pair),
    ),
    difficulty,
    sequence: RECOGNITION_NUMBERS.length + index + 1,
    // Both numerals, with an arrow for which one is wanted. The arrow has to
    // be taught once; the sentence has to be read every time.
    visual: {
      kind: 'numerals' as const,
      values: [...pair],
      want: kind as 'bigger' | 'smaller',
    },
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
  '2/4': 'two quarters',
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

/* --- Year 2 ---------------------------------------------------------------
 *
 * Built from the bounds each skill declares in the `Modal_data` curriculum
 * dataset (`Y2-*` ids below), but the questions and answers are produced here,
 * deterministically, and every answer is re-derived from its own prompt by
 * `tests/content-answer-keys.test.ts`. The dataset supplies the curriculum; it
 * never supplies an answer key.
 *
 * Only skills whose answer is a single whole number are built. Measurement,
 * geometry and statistics need clocks, shapes and charts to ask honestly, and a
 * badly-faked version of them would teach the wrong thing — they wait for a
 * slice that can draw.
 */

/** Y2-NPV-001 — count in steps of 2, 3, 5 and 10 within 100. */
const YEAR2_STEP_RUNS: Array<[number[], number, 1 | 2 | 3]> = [
  [[2, 4, 6], 2, 1], [[10, 20, 30], 10, 1], [[5, 10, 15], 5, 1],
  [[4, 6, 8], 2, 1], [[20, 30, 40], 10, 1], [[15, 20, 25], 5, 1],
  [[3, 6, 9], 3, 2], [[30, 40, 50], 10, 2], [[25, 30, 35], 5, 2],
  [[12, 14, 16], 2, 2], [[9, 12, 15], 3, 2], [[45, 50, 55], 5, 2],
  [[18, 21, 24], 3, 3], [[60, 70, 80], 10, 3], [[65, 70, 75], 5, 3],
  [[24, 27, 30], 3, 3], [[36, 38, 40], 2, 3], [[80, 85, 90], 5, 3],
  [[33, 36, 39], 3, 3], [[70, 80, 90], 10, 3], [[44, 46, 48], 2, 3],
];

const year2CountingTemplates: TemplateSeed[] = YEAR2_STEP_RUNS.map(
  ([run, step, difficulty], index) => ({
    id: `y2-count-${step}s-${run[0]}`,
    prompt: `Count on in ${step}s. ${run.join(', ')}. What comes next?`,
    correctAnswer: String(run[run.length - 1] + step),
    difficulty,
    sequence: index + 1,
  }),
);

/** Y2-NPV-002 — tens and ones within 99. */
const YEAR2_PLACE_VALUE: Array<[number, 'ones' | 'tens', 1 | 2 | 3]> = [
  [34, 'tens', 1], [27, 'ones', 1], [56, 'tens', 1], [83, 'ones', 1],
  [45, 'tens', 1], [19, 'ones', 1], [70, 'ones', 2],
];

/** Y2-NPV-003 — partitioning: 47 = 40 + ? */
const YEAR2_PARTITIONS: Array<[number, 1 | 2 | 3]> = [
  [47, 1], [62, 1], [35, 2], [78, 2], [91, 2], [26, 2], [53, 3],
];

/** Y2-NPV-004 — compare two numbers to 100. */
const YEAR2_COMPARISONS: Array<[number, number, 'larger' | 'smaller', 1 | 2 | 3]> = [
  [34, 43, 'larger', 2], [67, 76, 'smaller', 2], [90, 89, 'larger', 3],
  [55, 45, 'smaller', 3], [28, 82, 'larger', 3], [71, 17, 'smaller', 3],
  [100, 99, 'larger', 3],
];

const year2PlaceValueTemplates: TemplateSeed[] = [
  ...YEAR2_PLACE_VALUE.map(([value, place, difficulty], index) => ({
    id: `y2-place-${place}-${value}`,
    prompt: `In the number ${value}, which digit is in the ${place} column?`,
    correctAnswer: String(place === 'ones' ? value % 10 : Math.floor(value / 10) % 10),
    difficulty,
    sequence: index + 1,
  })),
  ...YEAR2_PARTITIONS.map(([value, difficulty], index) => ({
    id: `y2-partition-${value}`,
    prompt: `${value} is ${Math.floor(value / 10) * 10} add what?`,
    correctAnswer: String(value % 10),
    difficulty,
    sequence: YEAR2_PLACE_VALUE.length + index + 1,
  })),
  ...YEAR2_COMPARISONS.map(([left, right, kind, difficulty], index) => ({
    id: `y2-compare-${left}-${right}`,
    prompt: `Which number is ${kind}, ${left} or ${right}?`,
    correctAnswer: String(kind === 'larger' ? Math.max(left, right) : Math.min(left, right)),
    difficulty,
    sequence: YEAR2_PLACE_VALUE.length + YEAR2_PARTITIONS.length + index + 1,
  })),
];

/** Y2-AS-001 and Y2-AS-003/004 — facts to 20, then mental work within 100. */
const YEAR2_CALCULATIONS: Array<[number, '+' | '-', number, 1 | 2 | 3]> = [
  [8, '+', 7, 1], [9, '+', 6, 1], [13, '-', 5, 1], [16, '-', 9, 1],
  [7, '+', 8, 1], [20, '-', 4, 1], [12, '+', 6, 1],
  [34, '+', 5, 2], [47, '+', 20, 2], [56, '-', 4, 2], [72, '-', 30, 2],
  [28, '+', 7, 2], [63, '-', 8, 2], [45, '+', 30, 2],
  [36, '+', 27, 3], [54, '+', 38, 3], [72, '-', 46, 3], [83, '-', 57, 3],
  [49, '+', 25, 3], [61, '-', 34, 3], [58, '+', 36, 3],
];

const year2CalculationTemplates: TemplateSeed[] = YEAR2_CALCULATIONS.map(
  ([left, operator, right, difficulty], index) => ({
    id: `y2-calc-${left}-${operator === '+' ? 'plus' : 'minus'}-${right}`,
    prompt: `What is ${left} ${operator === '+' ? 'add' : 'subtract'} ${right}?`,
    correctAnswer: String(operator === '+' ? left + right : left - right),
    difficulty,
    sequence: index + 1,
  }),
);

/** Y2-MD-002 and Y2-MD-003 — the 2, 5 and 10 tables, and dividing by them. */
const YEAR2_TABLES: Array<[number, number, 1 | 2 | 3]> = [
  [2, 2, 1], [2, 5, 1], [10, 3, 1], [10, 5, 1], [2, 3, 1], [10, 2, 1], [2, 4, 1],
  [5, 2, 2], [5, 4, 2], [5, 6, 2], [2, 8, 2], [10, 7, 2], [5, 3, 2], [2, 9, 2],
];

const YEAR2_DIVISIONS: Array<[number, number, 1 | 2 | 3]> = [
  [20, 2, 3], [30, 10, 3], [25, 5, 3], [40, 5, 3], [18, 2, 3], [60, 10, 3], [45, 5, 3],
];

const year2TableTemplates: TemplateSeed[] = [
  ...YEAR2_TABLES.map(([a, b, difficulty], index) => ({
    id: `y2-times-${a}-x-${b}`,
    prompt: `What is ${a} times ${b}?`,
    correctAnswer: String(a * b),
    difficulty,
    sequence: index + 1,
  })),
  ...YEAR2_DIVISIONS.map(([total, divisor, difficulty], index) => ({
    id: `y2-divide-${total}-by-${divisor}`,
    prompt: `What is ${total} shared into groups of ${divisor}?`,
    correctAnswer: String(total / divisor),
    difficulty,
    sequence: YEAR2_TABLES.length + index + 1,
  })),
];

/** Y2-F-001 and Y2-F-002 — unit and non-unit fractions of a quantity. */
const YEAR2_FRACTIONS: Array<[number, number, number, 1 | 2 | 3]> = [
  [1, 2, 10, 1], [1, 2, 6, 1], [1, 2, 14, 1], [1, 4, 8, 1], [1, 4, 24, 1],
  [1, 3, 6, 1], [1, 3, 12, 1],
  [1, 2, 18, 2], [1, 4, 16, 2], [1, 3, 15, 2], [1, 2, 24, 2], [1, 4, 28, 2],
  [1, 3, 21, 2], [1, 2, 30, 2],
  [3, 4, 8, 3], [2, 4, 12, 3], [3, 4, 12, 3], [2, 3, 12, 3], [3, 4, 24, 3],
  [2, 3, 15, 3], [2, 4, 20, 3],
];

const year2FractionTemplates: TemplateSeed[] = YEAR2_FRACTIONS.map(
  ([numerator, denominator, amount, difficulty], index) => {
    const words = FRACTION_WORDS[`${numerator}/${denominator}`];
    if (!words) throw new Error(`no spoken wording for ${numerator}/${denominator}`);
    return {
      id: `y2-fraction-${numerator}-${denominator}-of-${amount}`,
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
    id: 'year2.counting-in-steps',
    title: 'Counting in 2s, 3s, 5s and 10s',
    yearGroup: 'year2',
    answerEntry: 'keypad',
    curriculumVersion: 'year2-maths-v1',
    datasetSkillIds: ['Y2-NPV-001'],
    source: DATASET_SOURCE,
    licence: LICENCE,
    templates: year2CountingTemplates,
  },
  {
    id: 'year2.place-value-to-100',
    title: 'Tens and ones to 100',
    yearGroup: 'year2',
    answerEntry: 'keypad',
    curriculumVersion: 'year2-maths-v1',
    datasetSkillIds: ['Y2-NPV-002', 'Y2-NPV-003', 'Y2-NPV-004'],
    source: DATASET_SOURCE,
    licence: LICENCE,
    templates: year2PlaceValueTemplates,
  },
  {
    id: 'year2.add-and-subtract',
    title: 'Adding and subtracting to 100',
    yearGroup: 'year2',
    answerEntry: 'keypad',
    curriculumVersion: 'year2-maths-v1',
    datasetSkillIds: ['Y2-AS-001', 'Y2-AS-003', 'Y2-AS-004', 'Y2-AS-005'],
    source: DATASET_SOURCE,
    licence: LICENCE,
    templates: year2CalculationTemplates,
  },
  {
    id: 'year2.times-tables',
    title: 'Times tables: 2, 5 and 10',
    yearGroup: 'year2',
    answerEntry: 'keypad',
    curriculumVersion: 'year2-maths-v1',
    datasetSkillIds: ['Y2-MD-002', 'Y2-MD-003'],
    source: DATASET_SOURCE,
    licence: LICENCE,
    templates: year2TableTemplates,
  },
  {
    id: 'year2.fractions-of-amounts',
    title: 'Fractions of amounts',
    yearGroup: 'year2',
    answerEntry: 'keypad',
    curriculumVersion: 'year2-maths-v1',
    datasetSkillIds: ['Y2-F-001', 'Y2-F-002'],
    source: DATASET_SOURCE,
    licence: LICENCE,
    templates: year2FractionTemplates,
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
  year2: 'year2.add-and-subtract',
  year3: 'year3.times-tables',
};