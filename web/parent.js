/**
 * Parent controls. No framework, no build step: this page is read by one adult
 * on one machine, and the smallest thing that works is the thing least likely
 * to break in a year's time.
 *
 * The admin secret is held in sessionStorage rather than localStorage so that
 * closing the browser forgets it.
 */

const SECRET_KEY = 'ai-family-tutor.admin-secret';

const el = (id) => document.getElementById(id);
const status = el('status');
let currentChildId = null;

function show(message, isError = false) {
  status.textContent = message;
  status.className = isError ? 'warn' : '';
  status.hidden = !message;
}

function secret() {
  return el('secret').value || sessionStorage.getItem(SECRET_KEY) || '';
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json' };
  const value = secret();
  if (value) headers['x-admin-secret'] = value;

  const response = await fetch(`/api/parent${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    throw new Error('The admin secret was not accepted.');
  }
  if (!response.ok) {
    // The server deliberately never explains itself; say something true.
    throw new Error('That request was refused.');
  }
  return response.json();
}

function table(node, columns, rows, emptyMessage) {
  node.innerHTML = '';
  if (rows.length === 0) {
    const caption = document.createElement('caption');
    caption.className = 'muted';
    caption.style.captionSide = 'bottom';
    caption.style.textAlign = 'left';
    caption.textContent = emptyMessage;
    node.append(caption);
    return;
  }

  const head = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (column.numeric) th.className = 'numeric';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  node.append(thead);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      const value = column.render(row);
      if (value instanceof Node) td.append(value);
      else td.textContent = value === null || value === undefined ? '' : String(value);
      if (column.numeric) td.className = 'numeric';
      tr.append(td);
    }
    body.append(tr);
  }
  node.append(body);
}

function button(label, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

const when = (value) =>
  value ? new Date(`${String(value).replace(' ', 'T')}Z`).toLocaleString() : '';

async function loadChildren() {
  const { children } = await api('/children');
  el('children-section').hidden = false;
  el('privacy-section').hidden = false;

  table(
    el('children'),
    [
      { label: 'Child', render: (child) => child.childId },
      { label: 'Sessions', numeric: true, render: (child) => child.sessionCount },
      { label: 'Today', numeric: true, render: (child) => child.sessionsToday },
      { label: 'Year', render: (child) => child.yearGroup || '' },
      { label: 'Limit', numeric: true, render: (child) => child.dailySessionLimit },
      { label: 'Last session', render: (child) => when(child.lastSessionAt) },
      {
        label: '',
        render: (child) =>
          button('Open', () => loadChild(child.childId).catch(fail)),
      },
    ],
    children,
    'No child has started a session yet.',
  );
}

async function loadChild(childId) {
  const overview = await api(`/children/${encodeURIComponent(childId)}/overview`);
  currentChildId = childId;
  el('child-section').hidden = false;
  el('child-heading').textContent = childId;
  el('daily-limit').value = overview.settings.dailySessionLimit;
  el('year-group').value = overview.settings.yearGroup;
  el('limit-note').textContent =
    `${overview.settings.sessionsToday} started today. ` +
    `Next reset ${when(overview.settings.nextAvailableAt)}.`;

  table(
    el('mastery'),
    [
      { label: 'Skill', render: (row) => row.skillTitle || row.skillId },
      { label: 'Level', render: (row) => row.level },
      { label: 'Correct', numeric: true, render: (row) => row.correctAttempts },
      { label: 'Answered', numeric: true, render: (row) => row.totalAttempts },
      {
        label: 'Score',
        numeric: true,
        render: (row) => `${Math.round(row.score * 100)}%`,
      },
    ],
    overview.mastery,
    'No graded answers yet.',
  );

  table(
    el('sessions'),
    [
      { label: 'Session', render: (row) => row.label },
      { label: 'Skill', render: (row) => row.skillTitle || row.skillId },
      { label: 'Started', render: (row) => when(row.startedAt) },
      { label: 'Ended', render: (row) => row.status },
      { label: 'Answered', numeric: true, render: (row) => row.answered },
      { label: 'Correct', numeric: true, render: (row) => row.correct },
      { label: 'Skipped', numeric: true, render: (row) => row.skipped },
    ],
    overview.sessions,
    'No sessions recorded.',
  );

  table(
    el('attempts'),
    [
      { label: 'When', render: (row) => when(row.createdAt) },
      { label: 'Question', render: (row) => row.prompt },
      { label: 'Answer', render: (row) => row.answer || '(skipped)' },
      {
        label: 'Marked',
        render: (row) => {
          if (row.outcome !== 'answered') return 'skipped';
          const mark = row.effectiveCorrect ? 'correct' : 'wrong';
          return row.corrected ? `${mark} (corrected)` : mark;
        },
      },
      {
        label: '',
        render: (row) => {
          if (row.outcome !== 'answered') return '';
          const wrapper = document.createElement('span');
          if (row.corrected) {
            wrapper.append(
              button('Undo correction', () => reverseCorrection(row.attemptId)),
            );
          } else {
            wrapper.append(
              button(
                row.effectiveCorrect ? 'Mark as wrong' : 'Mark as correct',
                () => correct(row.attemptId, !row.effectiveCorrect),
              ),
            );
          }
          return wrapper;
        },
      },
    ],
    overview.attempts,
    'No questions answered yet.',
  );

  table(
    el('corrections'),
    [
      { label: 'When', render: (row) => when(row.createdAt) },
      { label: 'Action', render: (row) => row.action },
      {
        label: 'Child scored',
        render: (row) => (row.originalIsCorrect ? 'correct' : 'wrong'),
      },
      {
        label: 'Now counts as',
        render: (row) =>
          row.correctedIsCorrect === null
            ? 'the child’s own result'
            : row.correctedIsCorrect
              ? 'correct'
              : 'wrong',
      },
      { label: 'Reason', render: (row) => row.reason },
    ],
    overview.corrections,
    'No corrections have been made.',
  );

  table(
    el('events'),
    [
      { label: 'When', render: (row) => when(row.createdAt) },
      { label: 'Session', render: (row) => `Session ${row.sessionNumber ?? '?'}` },
      { label: 'Event', render: (row) => row.eventType },
    ],
    overview.events,
    'No safety or fallback events.',
  );

  show(`Loaded ${childId}.`);
}

async function correct(attemptId, isCorrect) {
  const reason = window.prompt(
    'Why is this being corrected? This is kept with the record.',
  );
  if (!reason || !reason.trim()) return;
  await api(`/attempts/${encodeURIComponent(attemptId)}/correction`, {
    method: 'POST',
    body: { isCorrect, reason },
  }).catch(fail);
  await loadChild(currentChildId).catch(fail);
}

async function reverseCorrection(attemptId) {
  await api(`/attempts/${encodeURIComponent(attemptId)}/correction`, {
    method: 'DELETE',
  }).catch(fail);
  await loadChild(currentChildId).catch(fail);
}

async function loadPrivacy() {
  const privacy = await api('/privacy');
  const node = el('privacy');
  node.innerHTML = '';

  const list = (title, items) => {
    const heading = document.createElement('h3');
    heading.textContent = title;
    const ul = document.createElement('ul');
    ul.className = 'plain';
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.append(li);
    }
    node.append(heading, ul);
  };

  list('Where the data lives', [
    privacy.storage.location,
    `Database file: ${privacy.storage.databasePath}`,
  ]);
  list('How this app is reached', [
    `Bound to ${privacy.network.host}:${privacy.network.port}`,
    privacy.network.assumption,
    privacy.parentAccess.detail,
  ]);
  list('What is stored', privacy.stored);
  list('What is never stored', privacy.notStored);
  list('Records held now', [
    `${privacy.counts.children} children, ${privacy.counts.sessions} sessions, ` +
      `${privacy.counts.attempts} answers`,
    `${privacy.counts.corrections} corrections, ` +
      `${privacy.counts.safetyEvents} safety events, ` +
      `${privacy.counts.cacheEntries} cached items`,
    privacy.retention.lastRunAt
      ? `Retention last ran ${when(privacy.retention.lastRunAt)}`
      : 'Retention has never been run.',
  ]);

  el('session-days').value = privacy.retention.sessionDays;
  el('event-days').value = privacy.retention.eventDays;
}

function fail(error) {
  show(error.message || String(error), true);
}

async function refresh() {
  show('Loading…');
  await loadChildren();
  await loadPrivacy();
  show('');
}

el('connect').addEventListener('click', () => {
  const value = el('secret').value;
  if (value) sessionStorage.setItem(SECRET_KEY, value);
  refresh().catch(fail);
});

el('forget').addEventListener('click', () => {
  sessionStorage.removeItem(SECRET_KEY);
  el('secret').value = '';
  show('Secret forgotten for this browser session.');
});

el('save-limit').addEventListener('click', () => {
  api(`/children/${encodeURIComponent(currentChildId)}/settings`, {
    method: 'PUT',
    body: { dailySessionLimit: Number(el('daily-limit').value) },
  })
    .then(() => loadChild(currentChildId))
    .then(() => show('Daily limit saved.'))
    .catch(fail);
});

el('reset-today').addEventListener('click', () => {
  // Destructive and easy to hit by mistake next to the other controls, so it
  // asks first and says exactly what it removes.
  if (
    !window.confirm(
      "Delete today's sessions and answers for this child?\n\n" +
        'Their practice from earlier days is kept, and mastery is recalculated ' +
        'from what remains. This cannot be undone.',
    )
  ) {
    return;
  }

  api(`/children/${encodeURIComponent(currentChildId)}/reset-today`, { method: 'POST' })
    .then((result) => {
      return loadChild(currentChildId).then(() =>
        show(
          `Today reset: ${result.sessionsRemoved} session(s) and ` +
            `${result.attemptsRemoved} answer(s) removed.`,
        ),
      );
    })
    .catch(fail);
});

el('save-year').addEventListener('click', () => {
  api(`/children/${encodeURIComponent(currentChildId)}/settings`, {
    method: 'PUT',
    body: { yearGroup: el('year-group').value },
  })
    .then(() => loadChild(currentChildId))
    .then(() => show('Year group saved. Any session in progress was ended.'))
    .catch(fail);
});

el('export').addEventListener('click', () => {
  api(`/children/${encodeURIComponent(currentChildId)}/export`)
    .then((data) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentChildId}-export.json`;
      link.click();
      URL.revokeObjectURL(url);
      show('Export downloaded.');
    })
    .catch(fail);
});

el('delete').addEventListener('click', () => {
  const typed = window.prompt(
    `This permanently deletes everything stored about ${currentChildId}. ` +
      'Type the child id to confirm.',
  );
  if (typed !== currentChildId) {
    show('Deletion cancelled.');
    return;
  }
  api(`/children/${encodeURIComponent(currentChildId)}`, {
    method: 'DELETE',
    body: { confirm: currentChildId },
  })
    .then(() => {
      el('child-section').hidden = true;
      currentChildId = null;
      return refresh();
    })
    .then(() => show('The child’s data has been deleted.'))
    .catch(fail);
});

el('save-retention').addEventListener('click', () => {
  api('/retention', {
    method: 'PUT',
    body: {
      sessionDays: Number(el('session-days').value),
      eventDays: Number(el('event-days').value),
    },
  })
    .then(() => loadPrivacy())
    .then(() => show('Retention saved. Nothing is deleted until you run it.'))
    .catch(fail);
});

el('run-retention').addEventListener('click', () => {
  api('/retention/run', { method: 'POST' })
    .then((result) =>
      show(
        `Removed ${result.removed.sessions} sessions, ` +
          `${result.removed.attempts} answers and ` +
          `${result.removed.safetyEvents} events.`,
      ),
    )
    .then(() => loadPrivacy())
    .catch(fail);
});

el('clear-cache').addEventListener('click', () => {
  api('/cache/clear', { method: 'POST' })
    .then((result) => show(`Cleared ${result.cleared} cached items.`))
    .then(() => loadPrivacy())
    .catch(fail);
});

// A loopback install with no secret set can load straight away.
const stored = sessionStorage.getItem(SECRET_KEY);
if (stored) el('secret').value = stored;
refresh().catch(() => show('Enter the admin secret and choose Load.'));
