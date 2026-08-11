/**
 * Child session logic — DOM-free, dependency-free, framework-free.
 *
 * Everything that decides *what the child sees* lives here so that it can be
 * unit-tested under Node (`tests/web-session-logic.test.ts`). `index.html` is a
 * thin shell: it renders a state, sends the state's `command`, and dispatches
 * an event back in. No browser global is referenced in this file.
 *
 * Two product rules are enforced structurally rather than by convention:
 *
 *  1. Selecting a number NEVER produces a command. Marking an answer and
 *     advancing to the next question happen in one server transaction, so a
 *     submitted answer cannot be undone — a four-year-old's mistap would be
 *     recorded as evidence forever. Only `confirm` can issue an answer.
 *  2. Nothing internal reaches the child. Server responses carry mastery
 *     levels, scores, difficulties, skill ids and session ids; the only fields
 *     that survive into state are the prompt text and the question id (which is
 *     echoed back to the API and never rendered). `visibleText()` returns
 *     exactly the strings the shell may show or speak, so a test can assert
 *     that nothing internal ever appears in one.
 *
 * `web/package.json` marks this directory as ES modules so Node can import this
 * file directly; browsers use `<script type="module">` and ignore it.
 */

/* ------------------------------------------------------------------ copy --
 * All child-facing wording is here, in one place, at a Reception reading and
 * listening level. Short sentences, no jargon, no numbers about performance.
 */

export const COPY = Object.freeze({
  welcomeTitle: 'Who is playing?',
  gettingReady: 'Getting your questions ready.',
  begin: "Let's begin!",
  carryOn: "Let's carry on!",
  chooseFirst: 'Tap a number first.',
  chosen: (value) => `You picked ${value}. Now tap the big tick to send it.`,
  skipped: "That's okay. Here is a different one.",
  finishAsk: 'Are you finished for today?',
  troubleTitle: 'Oops!',
  troubleMessage: "We can't hear the tutor right now. Let's try again.",
  troubleSpeech: "Oops. We can't hear the tutor right now. Let's try again.",
  hintFallback: 'Try counting on your fingers, one at a time.',
});

/**
 * One ending per API status. Every status ends the session, so every status
 * gets a warm, complete-sounding screen — never a code such as
 * "question_limit". An unknown status falls back to the friendliest ending
 * rather than to an error, because a child cannot act on an error.
 */
const ENDINGS = Object.freeze({
  completed: {
    emoji: '🎉',
    title: 'All done!',
    message: 'Great work today.',
  },
  exhausted: {
    emoji: '🌟',
    title: 'You did them all!',
    message: 'There are no more questions for now.',
  },
  question_limit: {
    emoji: '🎉',
    title: 'You finished!',
    message: 'That is all the questions for today.',
  },
  time_limit: {
    emoji: '🌙',
    title: 'Time to stop!',
    message: 'You played for a long time. Well done.',
  },
  // Not an ending the child reached by working — they arrived already finished.
  // It must still sound like an achievement, because to them it is one.
  daily_limit: {
    emoji: '⭐',
    title: 'You already did today!',
    message: 'Come back tomorrow for more.',
  },
});

const DEFAULT_ENDING = ENDINGS.completed;

/** The child-facing ending for an API `status` or `endedReason`. */
export function endingFor(status) {
  const ending = ENDINGS[status] || DEFAULT_ENDING;
  return {
    emoji: ending.emoji,
    title: ending.title,
    message: ending.message,
    speech: `${ending.title} ${ending.message}`,
  };
}

/**
 * Feedback never reveals a score, a mastery level or the right answer. A wrong
 * answer is "good try" and the session moves on: the API has already marked it
 * and chosen the next question, so promising another go at the same question
 * would be a lie.
 */
export function feedbackFor(correct) {
  return correct
    ? {
        kind: 'correct',
        emoji: '⭐',
        title: 'Yes! Well done.',
        speech: 'Yes! Well done.',
      }
    : {
        kind: 'try-again',
        emoji: '💪',
        title: 'Good try!',
        speech: "Good try. Let's do another one.",
      };
}

/* --------------------------------------------------------------- answers --
 * The server strips `correct_answer` from every question it sends, so the
 * client genuinely does not know the answer. A shortlist of plausible options
 * therefore cannot be generated safely — it could omit the correct one. Every
 * answer in the reviewed bank is a whole number 0–10 (enforced by
 * `tests/content-bank.test.ts`), so the pad always offers all eleven.
 */

export const ANSWER_OPTIONS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
]);

export function answerOptions() {
  return ANSWER_OPTIONS.slice();
}

/* ------------------------------------------------------------- keyboard --
 * Keyboard parity for the pad. Digit keys select directly; "10" has no single
 * key, so pressing 1 then 0 in quick succession selects it. `now` is passed in
 * so this stays pure and testable.
 */

export const TEN_CHORD_MS = 900;

export function interpretDigitKey(key, chord, now) {
  if (typeof key !== 'string' || key.length !== 1 || key < '0' || key > '9') {
    return { value: null, chord: null };
  }
  if (key === '0' && chord && chord.digit === '1' && now - chord.at <= TEN_CHORD_MS) {
    return { value: '10', chord: null };
  }
  if (key === '1') {
    return { value: '1', chord: { digit: '1', at: now } };
  }
  return { value: key, chord: null };
}

/* ---------------------------------------------------------------- state -- */

/**
 * phase:
 *   welcome   — choose who is playing
 *   loading   — a request is in flight and there is nothing else to look at
 *   question  — prompt + pad; the child selects, then confirms
 *   feedback  — star or thumbs, briefly
 *   finishing — "are you finished?" confirmation, so one stray tap cannot end it
 *   ended     — a warm ending screen for any terminal status
 *   trouble   — the network or server is unavailable; offers one big retry
 */
export function initialState() {
  return {
    phase: 'welcome',
    sessionId: null,
    childId: null,
    question: null,
    options: [],
    answerEntry: 'tap-0-10',
    selected: null,
    busy: false,
    hint: null,
    hintPending: false,
    notice: null,
    feedback: null,
    afterFeedback: null,
    ending: null,
    trouble: null,
    command: null,
    retry: null,
    speak: null,
    announce: null,
  };
}

/** Keeps only what a child may see; drops difficulty, skillId, mastery, … */
function toChildQuestion(question) {
  if (!question || typeof question.prompt !== 'string') return null;
  return {
    id: String(question.id),
    prompt: question.prompt,
    // A picture of the question, for a child who can neither read the prompt
    // nor is listening to it. Unknown or malformed shapes are dropped rather
    // than guessed at: no picture is better than a misleading one.
    visual: toVisual(question.visual),
    // Reception taps a number from a row; Year 3 answers run past ten, so they
    // are typed on a keypad. Anything unrecognised falls back to the tap pad,
    // which is the safer of the two to show by mistake.
    answerEntry: question.answerEntry === 'keypad' ? 'keypad' : 'tap-0-10',
  };
}

const VISUAL_KINDS = ['groups', 'count', 'sequence', 'numerals'];

function toVisual(visual) {
  if (!visual || typeof visual !== 'object') return null;
  if (!VISUAL_KINDS.includes(visual.kind)) return null;
  const whole = (value) => Number.isInteger(value) && value >= 0 && value <= 10;

  if (visual.kind === 'groups') {
    return Array.isArray(visual.groups) && visual.groups.every(whole)
      ? { kind: 'groups', groups: visual.groups.slice() }
      : null;
  }
  if (visual.kind === 'count') {
    return whole(visual.total) ? { kind: 'count', total: visual.total } : null;
  }
  if (visual.kind === 'sequence') {
    return Array.isArray(visual.shown) && visual.shown.every(whole)
      ? { kind: 'sequence', shown: visual.shown.slice() }
      : null;
  }
  return Array.isArray(visual.values) && visual.values.every(whole)
    ? {
        kind: 'numerals',
        values: visual.values.slice(),
        want: visual.want === 'bigger' || visual.want === 'smaller' ? visual.want : null,
      }
    : null;
}

/** A snapshot to come back to if a request fails, without nesting retries. */
function snapshot(state) {
  return { ...state, command: null, retry: null, speak: null, announce: null };
}

function issue(state, command, event) {
  return {
    ...state,
    busy: true,
    command,
    retry: { state: snapshot(state), event },
  };
}

function quiet(state) {
  // A state the shell will render but neither speak nor re-announce.
  return { ...state, command: null, speak: null, announce: null };
}

function askQuestion(state, question, notice) {
  const child = toChildQuestion(question);
  if (!child) return endedState(state, 'exhausted');
  const speech = notice ? `${notice} ${child.prompt}` : child.prompt;
  return {
    ...state,
    phase: 'question',
    question: child,
    answerEntry: child.answerEntry,
    // A keypad builds its answer digit by digit, so it starts with no options.
    options: child.answerEntry === 'keypad' ? [] : answerOptions(),
    selected: null,
    hint: null,
    hintPending: false,
    busy: false,
    feedback: null,
    afterFeedback: null,
    ending: null,
    trouble: null,
    notice: notice || null,
    command: null,
    speak: speech,
    announce: child.prompt,
  };
}

function endedState(state, status) {
  const ending = endingFor(status);
  return {
    ...state,
    phase: 'ended',
    question: null,
    options: [],
    selected: null,
    hint: null,
    hintPending: false,
    busy: false,
    feedback: null,
    afterFeedback: null,
    notice: null,
    trouble: null,
    ending,
    command: null,
    speak: ending.speech,
    announce: `${ending.title} ${ending.message}`,
  };
}

function troubleState(state) {
  return {
    ...state,
    phase: 'trouble',
    busy: false,
    hintPending: false,
    command: null,
    trouble: { title: COPY.troubleTitle, message: COPY.troubleMessage },
    speak: COPY.troubleSpeech,
    announce: COPY.troubleMessage,
  };
}

/**
 * Advances after an answer or a skip. `nextQuestion` and `status` disagree only
 * when something has gone odd server-side; treating a missing question as an
 * ending (whatever the status says) keeps the child out of a dead screen.
 */
function advance(state, response, notice) {
  const next = response && response.nextQuestion;
  if (next && response.status === 'active') return askQuestion(state, next, notice);
  return endedState(state, (response && response.status) || 'completed');
}

/* -------------------------------------------------------------- reducer -- */

/**
 * Pure: `(state, event) -> state`. The shell performs `state.command` (if any)
 * and dispatches the outcome back as another event. Guarded transitions return
 * the state unchanged, which is what makes "one tap never submits" a property
 * of the machine rather than of the click handler.
 */
export function reduce(state, event) {
  switch (event.type) {
    case 'start': {
      if (state.busy) return state;
      const next = {
        ...initialState(),
        childId: event.childId,
        phase: 'loading',
        announce: COPY.gettingReady,
      };
      return issue(next, { kind: 'start', childId: event.childId, skillId: event.skillId }, event);
    }

    case 'started': {
      const response = event.response || {};
      const started = {
        ...state,
        sessionId: response.sessionId || null,
      };
      // The server answers 200 with a non-active status when there is nothing
      // to practise: every question is inside its re-ask window, or today's
      // session has already been used. Both are ordinary, healthy outcomes, so
      // each gets its own warm ending instead of being read as a failure.
      if (response.status && response.status !== 'active') {
        return endedState(started, response.status);
      }
      // A resumed session is a continuation, not a fresh start: same words a
      // grown-up would use when picking a book back up.
      return askQuestion(started, response.question, response.resumed ? COPY.carryOn : COPY.begin);
    }

    case 'select': {
      if (state.phase !== 'question' || state.busy) return state;
      const value = String(event.value);
      if (!state.options.includes(value)) return state;
      // Deliberately no command: selecting is reversible, sending is not.
      return {
        ...state,
        selected: value,
        command: null,
        speak: null,
        announce: COPY.chosen(value),
      };
    }

    /* Keypad entry. Same rule as tapping: building an answer is reversible and
       only confirm sends it, so a slip is never recorded as evidence. */
    case 'digit': {
      if (state.phase !== 'question' || state.busy) return state;
      if (state.answerEntry !== 'keypad') return state;
      const digit = String(event.value);
      if (!/^[0-9]$/.test(digit)) return state;
      const current = state.selected === null ? '' : state.selected;
      // Four digits covers every answer in the Year 3 bank with room to spare,
      // and stops a child filling the display by leaning on a key.
      if (current.length >= 4) return state;
      // No leading zeros: "05" and "5" would be the same answer typed two ways,
      // and only one of them matches the key.
      const next = current === '0' ? digit : current + digit;
      return {
        ...state,
        selected: next,
        command: null,
        speak: null,
        announce: COPY.chosen(next),
      };
    }

    case 'rub-out': {
      if (state.phase !== 'question' || state.busy) return state;
      if (state.answerEntry !== 'keypad' || state.selected === null) return state;
      const shorter = state.selected.slice(0, -1);
      return {
        ...state,
        selected: shorter === '' ? null : shorter,
        command: null,
        speak: null,
        announce: shorter === '' ? COPY.chooseFirst : COPY.chosen(shorter),
      };
    }

    case 'confirm': {
      if (state.phase !== 'question' || state.busy) return state;
      if (state.selected === null) {
        return {
          ...state,
          command: null,
          speak: COPY.chooseFirst,
          announce: COPY.chooseFirst,
        };
      }
      return issue(quiet(state), {
        kind: 'answer',
        sessionId: state.sessionId,
        questionId: state.question.id,
        answer: state.selected,
      }, event);
    }

    case 'graded': {
      const response = event.response || {};
      const feedback = feedbackFor(Boolean(response.correct));
      return {
        ...state,
        phase: 'feedback',
        busy: false,
        hint: null,
        hintPending: false,
        notice: null,
        feedback,
        afterFeedback: {
          nextQuestion: toChildQuestion(response.nextQuestion),
          status: response.status,
        },
        command: null,
        speak: feedback.speech,
        announce: feedback.title,
      };
    }

    case 'continue': {
      if (state.phase !== 'feedback') return state;
      return advance(state, state.afterFeedback, null);
    }

    case 'skip': {
      if (state.phase !== 'question' || state.busy) return state;
      return issue(quiet(state), {
        kind: 'skip',
        sessionId: state.sessionId,
        questionId: state.question.id,
      }, event);
    }

    case 'skipped':
      return advance(state, event.response, COPY.skipped);

    case 'hint': {
      if (state.phase !== 'question' || state.hintPending) return state;
      return {
        ...quiet(state),
        hintPending: true,
        command: { kind: 'hint', sessionId: state.sessionId },
        retry: state.retry,
      };
    }

    case 'hinted': {
      // Only the hint text crosses over; `source` is a model/system detail.
      const text = event.response && typeof event.response.hint === 'string'
        ? event.response.hint.trim()
        : '';
      const hint = text || COPY.hintFallback;
      return { ...state, hintPending: false, hint, command: null, speak: hint, announce: hint };
    }

    case 'hint-failed':
      // A missing or slow model must never look like a failure to the child.
      return {
        ...state,
        hintPending: false,
        hint: COPY.hintFallback,
        command: null,
        speak: COPY.hintFallback,
        announce: COPY.hintFallback,
      };

    case 'ask-finish': {
      if (state.phase === 'ended' || state.phase === 'loading') return state;
      return { ...quiet(state), phase: 'finishing', speak: COPY.finishAsk, announce: COPY.finishAsk };
    }

    case 'cancel-finish': {
      if (state.phase !== 'finishing') return state;
      if (state.question) return askQuestion(state, state.question, null);
      return quiet({ ...state, phase: 'welcome' });
    }

    case 'finish': {
      if (state.busy) return state;
      if (!state.sessionId) return endedState(state, 'completed');
      return issue({ ...quiet(state), phase: 'loading' }, { kind: 'complete', sessionId: state.sessionId }, event);
    }

    case 'finished':
      return endedState(state, (event.response && event.response.endedReason) || 'completed');

    /**
     * The server refused to open a session — in practice because every
     * reviewed question has already been asked inside the re-ask window.
     * "Try again" could never succeed, so a trouble screen would trap the
     * child in a loop; the honest outcome is the same warm ending they get
     * when the bank runs dry mid-session.
     */
    case 'no-questions':
      return endedState(state, 'exhausted');

    case 'failed':
      return troubleState(state);

    case 'retry': {
      if (!state.retry) return reduce(initialState(), { type: 'restart' });
      return reduce(state.retry.state, state.retry.event);
    }

    case 'restart':
      return { ...initialState(), announce: COPY.welcomeTitle };

    default:
      return state;
  }
}

/* ----------------------------------------------------------- inspection -- */

/**
 * Every string the shell is allowed to render or speak, in one array. The
 * shell renders only from these fields, so a test that scans this output is
 * genuinely testing what a child can see and hear.
 */
export function visibleText(state) {
  const parts = [];
  const push = (value) => {
    if (typeof value === 'string' && value.length > 0) parts.push(value);
  };

  push(state.notice);
  push(state.question && state.question.prompt);
  push(state.hint);
  push(state.feedback && state.feedback.title);
  push(state.ending && state.ending.title);
  push(state.ending && state.ending.message);
  push(state.trouble && state.trouble.title);
  push(state.trouble && state.trouble.message);
  push(state.speak);
  push(state.announce);
  for (const option of state.options) push(option);

  return parts;
}
