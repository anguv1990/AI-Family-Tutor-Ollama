export type MasteryLevel = 'new' | 'learning' | 'secure';

export type MasteryCalculation = {
  level: MasteryLevel;
  correctAttempts: number;
  totalAttempts: number;
  score: number;
};

export function calculateMastery(
  gradedResults: readonly boolean[],
  previousLevel: MasteryLevel,
): MasteryCalculation {
  const totalAttempts = gradedResults.length;
  const correctAttempts = gradedResults.filter(Boolean).length;
  const score = totalAttempts === 0 ? 0 : correctAttempts / totalAttempts;
  const latestTwo = gradedResults.slice(-2);
  const twoLatestCorrect =
    latestTwo.length === 2 && latestTwo.every((result) => result);
  const twoLatestIncorrect =
    latestTwo.length === 2 && latestTwo.every((result) => !result);

  let level: MasteryLevel;
  if (totalAttempts === 0) {
    level = 'new';
  } else if (previousLevel === 'secure') {
    level = twoLatestIncorrect ? 'learning' : 'secure';
  } else if (totalAttempts >= 5 && score >= 0.8 && twoLatestCorrect) {
    level = 'secure';
  } else {
    level = 'learning';
  }

  return { level, correctAttempts, totalAttempts, score };
}
