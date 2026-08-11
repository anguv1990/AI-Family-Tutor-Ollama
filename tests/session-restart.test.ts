import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';

/**
 * Starting a session can legitimately answer "nothing to practise right now",
 * so the restart tests narrow the result to an active session once, here.
 */
function startActive(
  tutor: TutoringService,
  input: { childId: string; skillId?: string },
) {
  const result = tutor.startSession(input);
  assert.ok(
    result.sessionId && result.question,
    `expected an active session, got ${result.status}/${result.reason}`,
  );
  return { ...result, sessionId: result.sessionId, question: result.question };
}

describe('session persistence across application restarts', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryDatabasePath(): string {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'family-tutor-restart-'),
    );
    temporaryDirectories.push(directory);
    return path.join(directory, 'tutor.sqlite');
  }

  it('resumes the current question and retains mastery after a restart', () => {
    const filename = temporaryDatabasePath();

    const firstDatabase = createDatabase(filename);
    const firstRun = new TutoringService(firstDatabase);
    firstRun.seedInitialContent();
    const started = startActive(firstRun, { childId: 'restart-child' });
    const answered = firstRun.submitAnswer({
      sessionId: started.sessionId,
      questionId: started.question.id,
      answer: '2',
    });
    firstDatabase.close();

    const secondDatabase = createDatabase(filename);
    const secondRun = new TutoringService(secondDatabase);
    secondRun.seedInitialContent();
    const resumed = startActive(secondRun, { childId: 'restart-child' });

    assert.equal(resumed.resumed, true);
    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(resumed.question.id, answered.nextQuestion?.id);
    assert.deepEqual(resumed.mastery, answered.mastery);
    secondDatabase.close();
  });

  it('does not resume a session that was explicitly completed', () => {
    const filename = temporaryDatabasePath();

    const firstDatabase = createDatabase(filename);
    const firstRun = new TutoringService(firstDatabase);
    firstRun.seedInitialContent();
    const started = startActive(firstRun, { childId: 'restart-complete' });
    firstRun.submitAnswer({
      sessionId: started.sessionId,
      questionId: started.question.id,
      answer: '2',
    });
    firstRun.completeSession({ sessionId: started.sessionId });
    firstDatabase.close();

    const secondDatabase = createDatabase(filename);
    const secondRun = new TutoringService(secondDatabase);
    secondRun.seedInitialContent();
    // A second session on the same day needs the parent to have raised the
    // daily cap; this test is about resumption, not about the cap.
    secondDatabase
      .prepare('UPDATE children SET daily_session_limit = 2 WHERE id = ?')
      .run('restart-complete');
    const fresh = startActive(secondRun, { childId: 'restart-complete' });

    assert.equal(fresh.resumed, false);
    assert.notEqual(fresh.sessionId, started.sessionId);
    assert.equal(fresh.mastery.totalAttempts, 1, 'mastery survives the restart');
    secondDatabase.close();
  });
});
