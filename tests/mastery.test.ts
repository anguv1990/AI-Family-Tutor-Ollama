import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateMastery } from '../server/mastery';

describe('mastery rules', () => {
  it('starts new when there is no graded evidence', () => {
    assert.deepEqual(calculateMastery([], 'new'), {
      level: 'new',
      correctAttempts: 0,
      totalAttempts: 0,
      score: 0,
    });
  });

  it('moves to learning after the first graded attempt', () => {
    assert.equal(calculateMastery([true], 'new').level, 'learning');
    assert.equal(calculateMastery([false], 'new').level, 'learning');
  });

  it('requires five attempts, 80 percent correct, and two latest correct to become secure', () => {
    assert.equal(
      calculateMastery([false, true, true, true], 'learning').level,
      'learning',
    );
    assert.deepEqual(
      calculateMastery([false, true, true, true, true], 'learning'),
      {
        level: 'secure',
        correctAttempts: 4,
        totalAttempts: 5,
        score: 0.8,
      },
    );
  });

  it('keeps secure after one incorrect answer and demotes after two consecutive incorrect answers', () => {
    assert.equal(
      calculateMastery([true, true, true, true, true, false], 'secure').level,
      'secure',
    );
    assert.equal(
      calculateMastery(
        [true, true, true, true, true, false, false],
        'secure',
      ).level,
      'learning',
    );
  });
});
