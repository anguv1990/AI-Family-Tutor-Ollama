/**
 * When a skill should come back.
 *
 * The `Modal_data` curriculum schedules review at 1, 3, 7, 14 and 30 days.
 * Until now this application had a single flat rule — do not ask the same
 * question within 24 hours — which is a freshness guard, not a schedule: a
 * skill a child has been secure in for a month came back as often as one they
 * met yesterday.
 *
 * The interval is derived from the stored evidence rather than incremented as
 * we go, for the same reason mastery is a fold rather than a nudge: a parent
 * correction or a retention prune changes what the evidence says, and a
 * schedule kept separately would quietly disagree with it.
 */

export const SPACED_REVIEW_DAYS = [1, 3, 7, 14, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewSchedule = {
  /** Index into SPACED_REVIEW_DAYS. */
  step: number;
  days: number;
  nextReviewAt: Date;
};

/**
 * Trailing correct answers set the interval: one correct brings the skill back
 * tomorrow, two in three days, and so on to a month. A single wrong answer
 * sends it back to tomorrow, because the evidence that it was secure has just
 * been contradicted.
 */
export function nextReviewFor(graded: boolean[], from: Date): ReviewSchedule {
  let consecutiveCorrect = 0;
  for (let index = graded.length - 1; index >= 0; index -= 1) {
    if (!graded[index]) break;
    consecutiveCorrect += 1;
  }

  const step = Math.min(
    Math.max(consecutiveCorrect - 1, 0),
    SPACED_REVIEW_DAYS.length - 1,
  );
  const days = SPACED_REVIEW_DAYS[step];

  return { step, days, nextReviewAt: new Date(from.getTime() + days * DAY_MS) };
}

/** A skill is due when its review date has arrived, or it has never been set. */
export function isDue(nextReviewAt: string | null | undefined, now: Date): boolean {
  if (!nextReviewAt) return true;
  const due = Date.parse(nextReviewAt.includes('T') ? nextReviewAt : `${nextReviewAt}Z`);
  return !Number.isFinite(due) || due <= now.getTime();
}
