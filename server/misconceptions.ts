/**
 * Working out *why* an answer was wrong, deterministically.
 *
 * The `Modal_data` curriculum names the misconceptions to look for and what an
 * adult should do about each one. It cannot say which one a particular child
 * just made — that has to be read off the answer they actually gave.
 *
 * Because this application generates its own questions, their shapes are known
 * exactly, so the diagnosis is arithmetic rather than guesswork: answering 5 to
 * "3 + 2" when the parts were 3 and 2 is not a random slip, it is counting one
 * group and stopping. No model is involved, and nothing here can change a mark:
 * the answer was already wrong before this ran.
 *
 * Two audiences, deliberately worded differently:
 *  - `childHelp` is what a four-year-old hears. Short, kind, never "you are
 *    wrong twice over", and never the answer.
 *  - `adultNote` is what the parent page shows, in the dataset's own teaching
 *    language.
 */

export type Diagnosis = {
  /** Dataset pattern name where one fits, otherwise our own. */
  pattern: string;
  childHelp: string;
  adultNote: string;
};

type Rule = {
  /** Matches the prompt shapes this application generates. */
  match: RegExp;
  diagnose: (numbers: number[], correct: number, given: number) => Diagnosis | null;
};

const off = (given: number, correct: number, by: number) =>
  given === correct + by || given === correct - by;

const RULES: Rule[] = [
  // Addition, both spellings: "What is 3 + 2?" and "What is 34 add 5?"
  {
    match: /^What is (\d+) (?:\+|add) (\d+)\?$/,
    diagnose: ([a, b], correct, given) => {
      if (given === a || given === b) {
        return {
          pattern: 'counts_all_from_one',
          childHelp: 'Both groups join together. Count all of them.',
          adultNote:
            'Gave one part instead of the total. Encourage counting on from the known part.',
        };
      }
      // Off-by-one is checked before multiplying, because for small numbers
      // the two collide (3 + 2 answered 6 is both 3 x 2 and 5 + 1) and a
      // Reception child has not met multiplication at all. Telling them "this
      // one is adding, not times" when they simply miscounted teaches nothing.
      if (off(given, correct, 1)) {
        return {
          pattern: 'skips_or_double_counts',
          childHelp: 'So close. Count again slowly and touch each one.',
          adultNote:
            'Out by one, which is usually a counting slip rather than a method error. Slow down; move each object as it is counted.',
        };
      }
      if (given === a * b) {
        return {
          pattern: 'used_the_wrong_operation',
          childHelp: 'This one is adding. Put the groups together and count.',
          adultNote: 'Multiplied instead of adding.',
        };
      }
      return null;
    },
  },
  {
    match: /^What is (\d+) subtract (\d+)\?$/,
    diagnose: ([a, b], correct, given) => {
      if (given === a + b) {
        return {
          pattern: 'used_the_wrong_operation',
          childHelp: 'This one is taking away, not adding.',
          adultNote: 'Added instead of subtracting.',
        };
      }
      if (given === b - a) {
        return {
          pattern: 'subtracts_the_wrong_way',
          childHelp: 'Start at the big number and count back.',
          adultNote:
            'Subtracted the smaller from the larger digit-wise, or reversed the numbers.',
        };
      }
      if (off(given, correct, 1)) {
        return {
          pattern: 'skips_or_double_counts',
          childHelp: 'So close. Count back slowly, one at a time.',
          adultNote: 'Out by one when counting back.',
        };
      }
      return null;
    },
  },
  {
    match: /^What is (\d+) times (\d+)\?$/,
    diagnose: ([a, b], correct, given) => {
      if (given === a + b) {
        return {
          pattern: 'used_the_wrong_operation',
          childHelp: 'Times means lots of. Count that many groups.',
          adultNote: 'Added instead of multiplying — a very common slip early in tables.',
        };
      }
      if (off(given, correct, a) || off(given, correct, b)) {
        return {
          pattern: 'one_group_out',
          childHelp: 'Nearly. Count the groups again — one may be missing.',
          adultNote: 'Out by exactly one group, so the method is right and the count is not.',
        };
      }
      return null;
    },
  },
  {
    match: /^What is (\d+) shared into groups of (\d+)\?$/,
    diagnose: ([total, divisor], correct, given) => {
      if (given === total - divisor) {
        return {
          pattern: 'used_the_wrong_operation',
          childHelp: 'Sharing means making equal groups, not taking away.',
          adultNote: 'Subtracted instead of grouping.',
        };
      }
      if (given === total * divisor) {
        return {
          pattern: 'used_the_wrong_operation',
          childHelp: 'Sharing makes smaller groups, not a bigger number.',
          adultNote: 'Multiplied instead of dividing.',
        };
      }
      return null;
    },
  },
  // "Count on. 1, 2. What comes next?" and "Count on in 5s. 10, 15, 20. …"
  {
    match: /^Count (?:on|back)(?: in \d+s)?\. ([\d, ]+)\. What comes next\?$/,
    diagnose: (numbers, correct, given) => {
      const last = numbers[numbers.length - 1];
      if (given === last) {
        return {
          pattern: 'recounts_when_asked_how_many',
          childHelp: 'That was the last one. What comes after it?',
          adultNote:
            'Repeated the final number shown rather than continuing the sequence.',
        };
      }
      const step = numbers.length > 1 ? numbers[1] - numbers[0] : 1;
      if (given === last - step) {
        return {
          pattern: 'confuses_more_and_less',
          childHelp: 'This one goes the other way. Try again.',
          adultNote: 'Continued the sequence in the wrong direction.',
        };
      }
      if (step !== 1 && given === last + 1) {
        return {
          pattern: 'always_counts_one_by_one',
          childHelp: `This one jumps in ${step}s, not ones.`,
          adultNote: `Counted on by one instead of in ${step}s.`,
        };
      }
      return null;
    },
  },
  {
    match: /^In the number (\d+), which digit is in the (?:ones|tens|hundreds) column\?$/,
    diagnose: ([value], correct, given) => {
      if (given === value) {
        return {
          pattern: 'gives_the_whole_number',
          childHelp: 'Just one digit from the number, not all of it.',
          adultNote: 'Gave the whole number instead of the digit in the named column.',
        };
      }
      if (String(value).includes(String(given))) {
        return {
          pattern: 'reads_the_wrong_column',
          childHelp: 'That digit is in a different column. Look again.',
          adultNote:
            'Read a digit from the wrong column. Write the number into a place value grid.',
        };
      }
      return null;
    },
  },
  {
    match: /^(\d+) is (\d+) add what\?$/,
    diagnose: ([whole], correct, given) => {
      if (given === whole) {
        return {
          pattern: 'gives_the_whole_number',
          childHelp: 'How many more do we need to get there?',
          adultNote: 'Gave the whole number instead of the missing part.',
        };
      }
      return null;
    },
  },
  {
    match: /^Which number is (?:larger|smaller), (\d+) or (\d+)\?$/,
    diagnose: ([left, right], correct, given) => {
      if (given === left || given === right) {
        return {
          pattern: 'confuses_more_and_less',
          childHelp: 'That is the other one. Which one is being asked for?',
          adultNote:
            'Chose the opposite number, which is usually more/less confusion rather than place value. Place both on a number track.',
        };
      }
      return null;
    },
  },
  {
    match: /^Tap the (?:bigger|smaller) number\. (\d+) or (\d+)\.$/,
    diagnose: ([left, right], correct, given) => {
      if (given === left || given === right) {
        return {
          pattern: 'confuses_more_and_less',
          childHelp: 'That is the other one. Look at both again.',
          adultNote: 'Chose the opposite number. Physically compare the two amounts.',
        };
      }
      return null;
    },
  },
];

/** Fraction wording is words, not digits, so it needs its own reading. */
const FRACTION_PROMPT = /^What is ([a-z ]+) of (\d+)\?$/;
const FRACTION_PARTS: Record<string, [number, number]> = {
  'one half': [1, 2],
  'one third': [1, 3],
  'one quarter': [1, 4],
  'one fifth': [1, 5],
  'one eighth': [1, 8],
  'one tenth': [1, 10],
  'two thirds': [2, 3],
  'two quarters': [2, 4],
  'three quarters': [3, 4],
  'two fifths': [2, 5],
  'three tenths': [3, 10],
  'five eighths': [5, 8],
};

function diagnoseFraction(prompt: string, correct: number, given: number): Diagnosis | null {
  const match = prompt.match(FRACTION_PROMPT);
  if (!match) return null;
  const parts = FRACTION_PARTS[match[1]];
  if (!parts) return null;
  const [numerator, denominator] = parts;
  const amount = Number(match[2]);

  if (given === amount) {
    return {
      pattern: 'gives_the_whole_amount',
      childHelp: 'That is all of them. We only want part of them.',
      adultNote: 'Gave the whole amount rather than the fraction of it.',
    };
  }
  if (given === denominator) {
    return {
      pattern: 'answers_the_denominator',
      childHelp: 'That number says how many parts, not how many things.',
      adultNote:
        'Answered the denominator. Separate "how many parts" from "how many in each part".',
    };
  }
  if (numerator > 1 && given === amount / denominator) {
    return {
      pattern: 'finds_one_part_only',
      childHelp: `That is one part. We need ${numerator} of them.`,
      adultNote: `Found one part correctly but did not take ${numerator} of them.`,
    };
  }
  return null;
}

const GENERIC: Diagnosis = {
  pattern: 'unclassified',
  childHelp: 'Good try. Take your time with the next one.',
  adultNote: 'No known misconception matched this answer.',
};

/**
 * Diagnoses a wrong answer, or returns null when the answer was right or
 * nothing recognisable happened. Never throws: a session must not fail because
 * a diagnosis could not be made.
 */
export function diagnose(input: {
  prompt: string;
  correctAnswer: string;
  givenAnswer: string;
}): Diagnosis | null {
  const correct = Number(input.correctAnswer);
  const given = Number(input.givenAnswer);
  if (!Number.isFinite(correct) || !Number.isFinite(given)) return null;
  if (correct === given) return null;

  const fraction = diagnoseFraction(input.prompt, correct, given);
  if (fraction) return fraction;

  for (const rule of RULES) {
    const match = input.prompt.match(rule.match);
    if (!match) continue;
    const numbers = match
      .slice(1)
      .flatMap((group) => group.split(','))
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));
    try {
      const found = rule.diagnose(numbers, correct, given);
      if (found) return found;
    } catch {
      return GENERIC;
    }
    return GENERIC;
  }

  return GENERIC;
}
