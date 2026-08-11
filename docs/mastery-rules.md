# Reception Maths Mastery Rules — Version 1

These rules are deterministic. The AI model does not decide correctness, mastery, promotion, demotion, or question difficulty.

## Evidence

- An answered question is graded against its reviewed answer key.
- A correct or incorrect answer counts as one graded attempt.
- A skipped question is recorded for audit purposes but does not count as a graded attempt and does not change the score or mastery level.
- The score is `correct graded attempts / total graded attempts`.
- Where an adult has corrected an evaluation, the corrected result is the graded evidence. See *Parent corrections* below.

### Mastery is a fold over the stored evidence

Mastery is recalculated by replaying the child's graded attempts for that skill in order, from `new`, rather than by nudging the previously stored level. The stored level is therefore a pure function of the attempts currently in the database.

This is what makes the rest of the system safe to build on:

- Reversing a parent correction restores exactly the mastery that existed before it, with no dependence on the order in which corrections were applied.
- Retention that prunes old attempts cannot leave a stored level that the remaining evidence does not support.
- The same attempts always produce the same level, on any machine, whatever route they took to get there.

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

Selection is confined to the child's own year group. A Reception child is never offered a Year 3 skill and a Year 3 child is never offered a Reception one; asking for another year group's skill is refused rather than silently redirected. Mastery is held per child and skill, so the two curricula accumulate evidence independently.

The selector chooses the enabled, adult-reviewed question nearest the target difficulty, from within the skill the session was started on. If the target difficulty is exhausted during a session, it selects the nearest remaining difficulty. Ties break on the bank's teaching order (`sequence`) and then on template ID, so selection is reproducible.

A template is not selectable when any of the following holds:

- It is disabled or has not been adult-reviewed, or its skill is disabled.
- It belongs to a skill other than the session's own.
- It has already been asked in this session.
- **Re-ask window.** This child answered or skipped it within the last twenty-four hours. The window is per child and spans sessions, so a template a child met in an earlier sitting does not come straight back in the next one. Skips count: a question the child ducked is one they have already been shown.

If nothing is selectable, that is content exhaustion and the session ends as described below.

## Session stopping rule

A session ends at whichever of these comes first, and the reason is recorded on the session (`sessions.ended_reason`) and reported to the client as its status, so an ending is always visible to an adult rather than silent:

| Reason | Condition |
| --- | --- |
| `question_limit` | Eight **answered** questions. Skips do not count towards it — a child who skips has not practised. |
| `time_limit` | Ten minutes since the session started. |
| `completed` | The child chose to stop. |
| `exhausted` | No selectable question remains. |

The answer that meets a limit is still marked and still counts as evidence; only the question that would have followed it is withheld. A session that has already passed the question or time limit is never resumed: it is closed with the reason that stopped it, and a fresh session starts.

Both limits are evaluated against an injectable clock, so the rule is testable at a chosen moment. When a session has passed both, the time limit is the recorded reason, because ten minutes elapsed before the answer that triggered the check.

## Parent corrections

An adult can correct the evaluation of an answered attempt, with a reason. The rules are deterministic and the child's own result is never destroyed.

- **What changes.** The correction is stored on the attempt as `corrected_is_correct`. Mastery for that child and skill is immediately recalculated, treating the corrected value as the graded result. The attempt's own `is_correct` — what the child actually scored at the time — is never overwritten.
- **What is recorded.** Every correction and every reversal appends a row to `attempt_corrections` holding the action, the child's original result, the value in force after the action, the reason and the timestamp. The trail is append-only: a reversal never edits or deletes the row that applied the correction.
- **Reversal.** Withdrawing a correction clears `corrected_is_correct` and lets the child's own result stand again. Because mastery is a fold over the stored evidence, this restores the previous mastery exactly, including the level.
- **What cannot be corrected.** A skipped attempt has no evaluation to correct, so a correction on it is refused. A reason is required; an empty one is refused.
- **Who may do it.** Corrections are a parent operation and go through the authenticated parent routes described in `docs/privacy-controls.md`.

## Daily session cap

A wellbeing control rather than a mastery rule, but it decides whether evidence can be gathered at all: a child may start at most one **new** session per calendar day (local time) by default, adjustable per child by the parent from 0 to 10. Resuming a session already in progress is always allowed — the cap limits new sittings, not continuity. Reaching it is a normal state (`daily_limit`), never an error.

## Deferred cases

- Ambiguous answers will require an explicit non-graded outcome before they are supported.
- Confidence intervals and time-based evidence decay are outside version 1 and require adult review before changing these rules.
