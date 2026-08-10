import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';

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
    const started = firstRun.startSession({ childId: 'restart-child' });
    const answered = firstRun.submitAnswer({
      sessionId: started.sessionId,
      questionId: started.question.id,
      answer: '2',
    });
    firstDatabase.close();

    const secondDatabase = createDatabase(filename);
    const secondRun = new TutoringService(secondDatabase);
    secondRun.seedInitialContent();
    const resumed = secondRun.startSession({ childId: 'restart-child' });

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
    const started = firstRun.startSession({ childId: 'restart-complete' });
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
    const fresh = secondRun.startSession({ childId: 'restart-complete' });

    assert.equal(fresh.resumed, false);
    assert.notEqual(fresh.sessionId, started.sessionId);
    assert.equal(fresh.mastery.totalAttempts, 1, 'mastery survives the restart');
    secondDatabase.close();
  });
});
