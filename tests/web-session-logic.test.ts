import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, describe, it } from 'node:test';

/**
 * `web/session-logic.js` is a real ES module, because that is how the browser
 * loads it. This project compiles to CommonJS, and TypeScript would rewrite a
 * plain `import()` into `require()` — which cannot load ESM — so the import is
 * built at run time to survive the transform. `web/package.json` marks the
 * directory as `"type": "module"` so Node parses the file the same way a
 * browser does.
 */
const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<any>;

const MODULE_URL = pathToFileURL(
  path.resolve(process.cwd(), 'web/session-logic.js'),
).href;

/** A realistic server payload: full of internals the child must never meet. */
const MASTERY = {
  skillId: 'reception.addition-within-5',
  level: 'secure',
  correctAttempts: 4,
  totalAttempts: 5,
  score: 0.8,
};

const QUESTION = {
  id: 'reception.addition-within-5.tpl-07',
  skillId: 'reception.addition-within-5',
  prompt: 'What is 2 + 1?',
  difficulty: 3,
};

const NEXT_QUESTION = {
  id: 'reception.addition-within-5.tpl-11',
  skillId: 'reception.addition-within-5',
  prompt: 'What is 3 + 2?',
  difficulty: 2,
};

const START_RESPONSE = {
  sessionId: 'e6f1c0de-0000-4000-8000-abcdefabcdef',
  childId: 'child-a',
  skillId: 'reception.addition-within-5',
  question: QUESTION,
  mastery: MASTERY,
  resumed: false,
};

/** Strings that would betray internal state if they surfaced in the UI. */
const INTERNAL_TOKENS = [
  'secure',
  'learning',
  'mastery',
  'skillid',
  'difficulty',
  'correctattempts',
  'totalattempts',
  'score',
  '0.8',
  'reception.addition-within-5',
  'tpl-07',
  'tpl-11',
  'e6f1c0de',
  'question_limit',
  'time_limit',
  'exhausted',
  'ended_reason',
  'endedreason',
  'invalid_request',
  'undefined',
  'null',
  '[object',
];

describe('child session logic', () => {
  let logic: any;

  before(async () => {
    logic = await dynamicImport(MODULE_URL);
  });

  function startedSession(response: Record<string, unknown> = {}) {
    let state = logic.reduce(logic.initialState(), {
      type: 'start',
      childId: 'child-a',
    });
    state = logic.reduce(state, {
      type: 'started',
      response: { ...START_RESPONSE, ...response },
    });
    return state;
  }

  function assertNoInternals(state: any, note: string) {
    const haystack = logic.visibleText(state).join(' | ').toLowerCase();
    for (const token of INTERNAL_TOKENS) {
      assert.equal(
        haystack.includes(token),
        false,
        `${note}: child-visible text leaked "${token}" — ${haystack}`,
      );
    }
  }

  describe('question pictures', () => {
    it('keeps a well-formed picture', () => {
      const state = startedSession({
        question: { id: 'q1', prompt: 'What is 3 + 2?', visual: { kind: 'groups', groups: [3, 2] } },
      });
      assert.deepEqual(state.question.visual, { kind: 'groups', groups: [3, 2] });
    });

    it('drops a picture it does not understand rather than guessing', () => {
      // No picture is better than a misleading one: the child treats it as the
      // question, so a wrong picture is a wrong question.
      for (const visual of [
        { kind: 'spaceship', groups: [1] },
        { kind: 'groups', groups: 'three' },
        { kind: 'groups', groups: [1, 99] },
        { kind: 'count', total: -1 },
        { kind: 'sequence', shown: [1, null] },
        null,
        'dots',
      ]) {
        const state = startedSession({
          question: { id: 'q1', prompt: 'What is 3 + 2?', visual },
        });
        assert.equal(state.question.visual, null, `accepted ${JSON.stringify(visual)}`);
      }
    });

    it('carries the comparison arrow through', () => {
      const state = startedSession({
        question: {
          id: 'q1',
          prompt: 'Tap the bigger number. 1 or 3.',
          visual: { kind: 'numerals', values: [1, 3], want: 'bigger' },
        },
      });
      assert.equal(state.question.visual.want, 'bigger');
    });

    it('has no picture when the server sends none', () => {
      const state = startedSession({
        question: { id: 'q1', prompt: 'What is 555 add 278?', answerEntry: 'keypad' },
      });
      assert.equal(state.question.visual, null);
    });
  });

  describe('keypad entry for Year 3', () => {
    function typingSession() {
      return startedSession({
        question: { id: 'q-year3', prompt: 'What is 8 times 7?', answerEntry: 'keypad' },
      });
    }

    it('builds a multi-digit answer without ever sending it', () => {
      let state = typingSession();
      assert.equal(state.answerEntry, 'keypad');

      state = logic.reduce(state, { type: 'digit', value: '5' });
      state = logic.reduce(state, { type: 'digit', value: '6' });

      assert.equal(state.selected, '56');
      // The rule that protects a four-year-old protects an eight-year-old too:
      // typing is reversible, only confirm is not.
      assert.equal(state.command, null);
      assert.equal(state.busy, false);
    });

    it('rubs out the last digit', () => {
      let state = typingSession();
      for (const value of ['5', '6']) state = logic.reduce(state, { type: 'digit', value });
      state = logic.reduce(state, { type: 'rub-out' });
      assert.equal(state.selected, '5');

      state = logic.reduce(state, { type: 'rub-out' });
      assert.equal(state.selected, null, 'rubbing out the last digit clears the answer');

      state = logic.reduce(state, { type: 'rub-out' });
      assert.equal(state.selected, null, 'rubbing out an empty answer is harmless');
    });

    it('sends the typed answer only on confirm', () => {
      let state = typingSession();
      for (const value of ['5', '6']) state = logic.reduce(state, { type: 'digit', value });
      state = logic.reduce(state, { type: 'confirm' });

      assert.ok(state.command, 'confirm must issue the answer');
      assert.equal(state.command.kind, 'answer');
      assert.equal(state.command.answer, '56');
    });

    it('refuses a leading zero, which would not match the answer key', () => {
      let state = typingSession();
      state = logic.reduce(state, { type: 'digit', value: '0' });
      state = logic.reduce(state, { type: 'digit', value: '7' });
      assert.equal(state.selected, '7');
    });

    it('stops a child filling the display by leaning on a key', () => {
      let state = typingSession();
      for (const value of ['1', '2', '3', '4', '5', '6']) {
        state = logic.reduce(state, { type: 'digit', value });
      }
      assert.equal(state.selected.length, 4);
    });

    it('ignores keypad events on a Reception tap question', () => {
      const state = logic.reduce(startedSession(), { type: 'digit', value: '7' });
      assert.equal(state.selected, null, 'a tap question must not accept typed digits');
    });

    it('shows no tap options when the answer is typed', () => {
      assert.deepEqual(typingSession().options, []);
    });
  });

  describe('nothing to practise', () => {
    it('ends warmly when every question is inside its re-ask window', () => {
      const state = startedSession({
        status: 'exhausted',
        sessionId: null,
        question: null,
      });

      assert.equal(state.phase, 'ended');
      assert.equal(state.ending.title, 'You did them all!');
      assert.equal(state.trouble, null, 'a normal daily state must not look like a fault');
      assertNoInternals(state, 'exhausted start');
    });

    it('tells the child they have already practised today', () => {
      const state = startedSession({
        status: 'daily_limit',
        sessionId: null,
        question: null,
      });

      assert.equal(state.phase, 'ended');
      // The daily cap is a wellbeing control, so it must not read as a refusal.
      assert.equal(state.ending.title, 'You already did today!');
      assert.notEqual(
        state.ending.title,
        'You did them all!',
        'the cap and an empty bank need different endings — they need different adult responses',
      );
      assertNoInternals(state, 'daily limit start');
    });

    it('offers nothing to tap once the session cannot start', () => {
      const state = startedSession({ status: 'daily_limit', sessionId: null, question: null });
      assert.equal(state.command, null);
      assert.equal(state.question, null);
    });
  });

  describe('answer options', () => {
    it('offers every whole number from 0 to 10 and nothing else', () => {
      assert.deepEqual(
        logic.answerOptions(),
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      );
    });

    it('gives a fresh array so the shell cannot mutate the bank', () => {
      const first = logic.answerOptions();
      first.push('99');
      assert.equal(logic.answerOptions().length, 11);
    });
  });

  describe('select then confirm', () => {
    it('never submits on a single tap', () => {
      const state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      assert.equal(state.selected, '3');
      assert.equal(state.command, null);
      assert.equal(state.phase, 'question');
      assert.equal(state.busy, false);
    });

    it('lets a mistap be changed before it counts', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 9 });
      state = logic.reduce(state, { type: 'select', value: 4 });
      assert.equal(state.selected, '4');
      assert.equal(state.command, null);
    });

    it('ignores a tap that is not a real answer option', () => {
      const started = startedSession();
      const state = logic.reduce(started, { type: 'select', value: 11 });
      assert.equal(state.selected, null);
      assert.equal(state, started);
    });

    it('submits the selected answer only when confirmed', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      assert.deepEqual(state.command, {
        kind: 'answer',
        sessionId: START_RESPONSE.sessionId,
        questionId: QUESTION.id,
        answer: '3',
      });
      assert.equal(state.busy, true);
    });

    it('never submits from taps alone, for any number and any number of taps', () => {
      // The rule a mistap depends on: marking and advancing happen in one
      // server transaction, so there is no undo. Only `confirm` may send.
      let state = startedSession();
      for (const value of logic.answerOptions()) {
        state = logic.reduce(state, { type: 'select', value });
        assert.equal(state.command, null, `tapping ${value} issued a command`);
        assert.equal(state.busy, false);
        assert.equal(state.phase, 'question');
      }
      assert.equal(state.selected, '10');
    });

    it('asks for a number instead of submitting an empty confirm', () => {
      const state = logic.reduce(startedSession(), { type: 'confirm' });
      assert.equal(state.command, null);
      assert.match(state.speak, /tap a number/i);
    });

    it('will not double-submit while an answer is in flight', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      const again = logic.reduce(state, { type: 'confirm' });
      assert.equal(again, state);
      const tapped = logic.reduce(state, { type: 'select', value: 5 });
      assert.equal(tapped.selected, '3');
    });
  });

  describe('feedback', () => {
    it('celebrates a correct answer without mentioning a score', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      state = logic.reduce(state, {
        type: 'graded',
        response: {
          correct: true,
          nextQuestion: NEXT_QUESTION,
          status: 'active',
          mastery: MASTERY,
        },
      });
      assert.equal(state.phase, 'feedback');
      assert.equal(state.feedback.kind, 'correct');
      assert.ok(state.speak.length > 0);
      assertNoInternals(state, 'correct feedback');
    });

    it('gives a wrong answer encouragement, never the score or the answer', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 7 });
      state = logic.reduce(state, { type: 'confirm' });
      state = logic.reduce(state, {
        type: 'graded',
        response: {
          correct: false,
          nextQuestion: NEXT_QUESTION,
          status: 'active',
          mastery: { ...MASTERY, level: 'learning', score: 0.5 },
        },
      });
      assert.equal(state.feedback.kind, 'try-again');
      assert.match(state.feedback.title, /try/i);
      assert.equal(/wrong|incorrect|failed/i.test(logic.visibleText(state).join(' ')), false);
      assertNoInternals(state, 'try-again feedback');
    });

    it('moves on to the next question after the feedback', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      state = logic.reduce(state, {
        type: 'graded',
        response: { correct: true, nextQuestion: NEXT_QUESTION, status: 'active' },
      });
      state = logic.reduce(state, { type: 'continue' });
      assert.equal(state.phase, 'question');
      assert.equal(state.question.prompt, NEXT_QUESTION.prompt);
      assert.equal(state.selected, null, 'the previous choice must not carry over');
      assert.equal(state.hint, null, 'the previous hint must not carry over');
      assert.equal(state.speak, NEXT_QUESTION.prompt);
    });

    it('keeps only the prompt from a question, never its internals', () => {
      const state = startedSession();
      // `answerEntry` is a rendering instruction (tap row or keypad), not
      // information about the child or their progress, and it is never shown as
      // text — the leak check below still covers everything the child can read.
      assert.deepEqual(Object.keys(state.question).sort(), [
        'answerEntry',
        'id',
        'prompt',
        'visual',
      ]);
      assert.equal(state.question.difficulty, undefined);
      assert.equal(state.question.skillId, undefined);
      assert.equal(state.question.correctAnswer, undefined);
      assertNoInternals(state, 'question state');
    });
  });

  describe('endings', () => {
    for (const status of ['completed', 'exhausted', 'question_limit', 'time_limit']) {
      it(`gives "${status}" its own warm ending screen`, () => {
        let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
        state = logic.reduce(state, { type: 'confirm' });
        state = logic.reduce(state, {
          type: 'graded',
          response: { correct: true, nextQuestion: null, status, mastery: MASTERY },
        });
        state = logic.reduce(state, { type: 'continue' });

        assert.equal(state.phase, 'ended');
        assert.ok(state.ending.title.length > 0);
        assert.ok(state.ending.message.length > 0);
        assert.ok(state.speak.includes(state.ending.title));
        assertNoInternals(state, `ending for ${status}`);
      });
    }

    it('never puts the status string itself in front of the child', () => {
      for (const status of ['completed', 'exhausted', 'question_limit', 'time_limit']) {
        const ending = logic.endingFor(status);
        const shown = `${ending.emoji} ${ending.title} ${ending.message} ${ending.speech}`;
        assert.equal(shown.includes(status), false, `"${status}" was shown verbatim`);
        assert.equal(/_|session|status|limit|error/i.test(shown), false, `jargon in "${shown}"`);
        // Child-readable: short, warm, ends in a full stop or an exclamation.
        assert.ok(ending.title.length <= 24, `"${ending.title}" is too long to read aloud`);
        assert.match(ending.title, /[.!]$/);
      }
    });

    it('gives each status a distinguishable ending rather than one generic screen', () => {
      const titles = ['exhausted', 'question_limit', 'time_limit'].map(
        (status) => logic.endingFor(status).title,
      );
      assert.equal(new Set(titles).size, titles.length);
    });

    it('ends kindly on an unknown status instead of showing an error', () => {
      const ending = logic.endingFor('something_new_from_the_server');
      assert.ok(ending.title.length > 0);
      assert.equal(/error|status|something_new/i.test(`${ending.title} ${ending.message}`), false);
    });

    it('ends the session when there is no next question, whatever the status says', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      state = logic.reduce(state, {
        type: 'graded',
        response: { correct: true, nextQuestion: null, status: 'active' },
      });
      state = logic.reduce(state, { type: 'continue' });
      assert.equal(state.phase, 'ended');
    });
  });

  describe('resuming', () => {
    it('sounds like carrying on, not like starting over', () => {
      const resumed = startedSession({ resumed: true });
      const fresh = startedSession({ resumed: false });

      assert.notEqual(resumed.notice, fresh.notice);
      assert.match(resumed.notice, /carry on/i);
      assert.match(fresh.notice, /begin/i);
      assert.ok(resumed.speak.includes(QUESTION.prompt));
      assertNoInternals(resumed, 'resumed session');
    });

    it('asks the resumed question rather than a new one', () => {
      const resumed = startedSession({ resumed: true });
      assert.equal(resumed.phase, 'question');
      assert.equal(resumed.question.prompt, QUESTION.prompt);
    });
  });

  describe('skipping', () => {
    it('sends a skip only for the question on screen', () => {
      const state = logic.reduce(startedSession(), { type: 'skip' });
      assert.deepEqual(state.command, {
        kind: 'skip',
        sessionId: START_RESPONSE.sessionId,
        questionId: QUESTION.id,
      });
    });

    it('moves straight to the next question with a kind word, no feedback', () => {
      let state = logic.reduce(startedSession(), { type: 'skip' });
      state = logic.reduce(state, {
        type: 'skipped',
        response: { nextQuestion: NEXT_QUESTION, status: 'active', mastery: MASTERY },
      });
      assert.equal(state.phase, 'question');
      assert.equal(state.feedback, null);
      assert.equal(state.question.prompt, NEXT_QUESTION.prompt);
      assertNoInternals(state, 'after skip');
    });

    it('ends the session when a skip runs the bank out', () => {
      let state = logic.reduce(startedSession(), { type: 'skip' });
      state = logic.reduce(state, {
        type: 'skipped',
        response: { nextQuestion: null, status: 'exhausted', mastery: MASTERY },
      });
      assert.equal(state.phase, 'ended');
      assertNoInternals(state, 'exhausted by skip');
    });
  });

  describe('hints', () => {
    it('shows the hint text and never its source', () => {
      let state = logic.reduce(startedSession(), { type: 'hint' });
      assert.equal(state.command.kind, 'hint');
      state = logic.reduce(state, {
        type: 'hinted',
        response: { hint: 'Count on from two.', source: 'model:qwen2.5:7b' },
      });
      assert.equal(state.hint, 'Count on from two.');
      assert.equal(state.hintPending, false);
      assert.equal(logic.visibleText(state).join(' ').includes('qwen'), false);
    });

    it('still lets the child answer while a hint is being fetched', () => {
      const state = logic.reduce(startedSession(), { type: 'hint' });
      assert.equal(state.phase, 'question');
      assert.equal(state.busy, false);
      assert.equal(logic.reduce(state, { type: 'select', value: 2 }).selected, '2');
    });

    it('falls back to a real hint when the model is unavailable', () => {
      let state = logic.reduce(startedSession(), { type: 'hint' });
      state = logic.reduce(state, { type: 'hint-failed' });
      assert.ok(state.hint.length > 0);
      assert.equal(state.phase, 'question');
      assert.equal(/error|fail|model|ollama/i.test(state.hint), false);
    });

    it('does not queue a second hint while one is in flight', () => {
      const state = logic.reduce(startedSession(), { type: 'hint' });
      assert.equal(logic.reduce(state, { type: 'hint' }), state);
    });
  });

  describe('finishing', () => {
    it('asks before ending, so one stray tap cannot stop the session', () => {
      const asked = logic.reduce(startedSession(), { type: 'ask-finish' });
      assert.equal(asked.phase, 'finishing');
      assert.equal(asked.command, null);
    });

    it('returns to the same question when the child changes their mind', () => {
      let state = logic.reduce(startedSession(), { type: 'ask-finish' });
      state = logic.reduce(state, { type: 'cancel-finish' });
      assert.equal(state.phase, 'question');
      assert.equal(state.question.prompt, QUESTION.prompt);
    });

    it('completes the session on the server when confirmed', () => {
      let state = logic.reduce(startedSession(), { type: 'ask-finish' });
      state = logic.reduce(state, { type: 'finish' });
      assert.deepEqual(state.command, {
        kind: 'complete',
        sessionId: START_RESPONSE.sessionId,
      });
      state = logic.reduce(state, {
        type: 'finished',
        response: {
          endedReason: 'completed',
          questionsAnswered: 3,
          questionsSkipped: 1,
          mastery: MASTERY,
        },
      });
      assert.equal(state.phase, 'ended');
      assertNoInternals(state, 'after finishing');
    });
  });

  describe('when something goes wrong', () => {
    it('shows a calm message, not an error code', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      state = logic.reduce(state, { type: 'failed' });

      assert.equal(state.phase, 'trouble');
      assert.equal(state.busy, false);
      assert.equal(state.command, null);
      const text = logic.visibleText(state).join(' ');
      assert.equal(/\b(4\d\d|5\d\d)\b|error|fetch|http|stack/i.test(text), false);
      assertNoInternals(state, 'trouble screen');
    });

    it('retries exactly the request that failed', () => {
      let state = logic.reduce(startedSession(), { type: 'select', value: 3 });
      state = logic.reduce(state, { type: 'confirm' });
      state = logic.reduce(state, { type: 'failed' });
      state = logic.reduce(state, { type: 'retry' });

      assert.deepEqual(state.command, {
        kind: 'answer',
        sessionId: START_RESPONSE.sessionId,
        questionId: QUESTION.id,
        answer: '3',
      });
    });

    it('ends warmly, not in a retry loop, when there is nothing left to ask', () => {
      // The server refuses to open a session once every reviewed question is
      // inside its re-ask window, so "try again" could never succeed.
      let state = logic.reduce(logic.initialState(), { type: 'start', childId: 'child-a' });
      state = logic.reduce(state, { type: 'no-questions' });

      assert.equal(state.phase, 'ended');
      assert.equal(state.command, null);
      assert.ok(state.ending.title.length > 0);
      assertNoInternals(state, 'nothing left to ask');
    });

    it('recovers to the welcome screen when the very first request fails', () => {
      let state = logic.reduce(logic.initialState(), { type: 'start', childId: 'child-a' });
      state = logic.reduce(state, { type: 'failed' });
      assert.equal(state.phase, 'trouble');
      state = logic.reduce(state, { type: 'retry' });
      assert.equal(state.command.kind, 'start');
      assert.equal(state.command.childId, 'child-a');
    });
  });

  describe('keyboard entry', () => {
    it('selects the digit that was pressed', () => {
      assert.equal(logic.interpretDigitKey('7', null, 1000).value, '7');
      assert.equal(logic.interpretDigitKey('0', null, 1000).value, '0');
    });

    it('makes ten reachable by pressing one then zero', () => {
      const first = logic.interpretDigitKey('1', null, 1000);
      assert.equal(first.value, '1');
      assert.equal(logic.interpretDigitKey('0', first.chord, 1200).value, '10');
    });

    it('treats a slow zero after a one as plain zero', () => {
      const first = logic.interpretDigitKey('1', null, 1000);
      assert.equal(
        logic.interpretDigitKey('0', first.chord, 1000 + logic.TEN_CHORD_MS + 1).value,
        '0',
      );
    });

    it('ignores keys that are not digits', () => {
      for (const key of ['a', 'Enter', 'ArrowUp', ' ']) {
        assert.equal(logic.interpretDigitKey(key, null, 1000).value, null);
      }
    });
  });

  describe('nothing internal ever reaches the child', () => {
    it('holds across a whole session', () => {
      let state = logic.reduce(logic.initialState(), { type: 'start', childId: 'child-a' });
      assertNoInternals(state, 'loading');

      state = logic.reduce(state, { type: 'started', response: START_RESPONSE });
      assertNoInternals(state, 'first question');

      state = logic.reduce(state, { type: 'select', value: 3 });
      assertNoInternals(state, 'selected');

      state = logic.reduce(state, { type: 'confirm' });
      assertNoInternals(state, 'submitting');

      state = logic.reduce(state, {
        type: 'graded',
        response: { correct: false, nextQuestion: NEXT_QUESTION, status: 'active', mastery: MASTERY },
      });
      assertNoInternals(state, 'feedback');

      state = logic.reduce(state, { type: 'continue' });
      assertNoInternals(state, 'next question');

      state = logic.reduce(state, { type: 'skip' });
      state = logic.reduce(state, {
        type: 'skipped',
        response: { nextQuestion: null, status: 'question_limit', mastery: MASTERY },
      });
      assertNoInternals(state, 'ended');
    });
  });
});
