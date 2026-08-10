# Reception Maths Mastery Rules — Version 1

These rules are deterministic. The AI model does not decide correctness, mastery, promotion, demotion, or question difficulty.

## Evidence

- An answered question is graded against its reviewed answer key.
- A correct or incorrect answer counts as one graded attempt.
- A skipped question is recorded for audit purposes but does not count as a graded attempt and does not change the score or mastery level.
- The score is `correct graded attempts / total graded attempts`.

## Levels

### New

The learner has no graded attempts for the skill. Questions target difficulty 1.

### Learning

The learner has at least one graded attempt but has not met the secure threshold, or has been demoted from secure. Questions target difficulty 2.

### Secure

Promotion from learning requires all of the following:

- At least five graded attempts
- A score of at least 80%
- The latest two graded attempts are correct

Questions target difficulty 3.

An already-secure learner remains secure after one incorrect answer. Two consecutive incorrect graded attempts demote the learner to learning.

## Question selection

The selector first chooses an enabled, adult-reviewed, unanswered question nearest the target difficulty. It uses a stable template-ID order to make the behavior reproducible. If the target difficulty is exhausted during a session, it selects the nearest remaining difficulty.

## Deferred cases

- Parent corrections will recalculate evidence in the parent-correction slice.
- Ambiguous answers will require an explicit non-graded outcome before they are supported.
- Confidence intervals and time-based evidence decay are outside version 1 and require adult review before changing these rules.
