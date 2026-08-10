import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';

describe('tutoring session API', () => {
  let database: Database.Database;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();
    await new Promise<void>((resolve, reject) => {
      server = createApp(tutor).listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await closed;
    database.close();
  });

  it('completes start -> answer -> next question over HTTP', async () => {
    const startResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'api-child' }),
    });
    assert.equal(startResponse.status, 201);
    const session = (await startResponse.json()) as {
      sessionId: string;
      question: { id: string; prompt: string; correctAnswer?: string };
    };
    assert.equal(session.question.prompt, 'What is 1 + 1?');
    assert.equal(session.question.correctAnswer, undefined);

    const answerResponse = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}/answers`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: session.question.id, answer: '2' }),
      },
    );
    assert.equal(answerResponse.status, 200);
    const result = (await answerResponse.json()) as {
      correct: boolean;
      mastery: { level: string; score: number };
      nextQuestion: { id: string; difficulty: number };
    };
    assert.equal(result.correct, true);
    assert.equal(result.mastery.level, 'learning');
    assert.equal(result.mastery.score, 1);
    assert.notEqual(result.nextQuestion.id, session.question.id);
    assert.equal(result.nextQuestion.difficulty, 2);
  });

  it('records a skipped question without adding graded evidence', async () => {
    const startResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'api-skip-child' }),
    });
    const session = (await startResponse.json()) as {
      sessionId: string;
      question: { id: string };
    };

    const skipResponse = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}/skip`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: session.question.id }),
      },
    );
    assert.equal(skipResponse.status, 200);
    const result = (await skipResponse.json()) as {
      mastery: { level: string; totalAttempts: number };
      nextQuestion: { difficulty: number };
    };
    assert.deepEqual(result.mastery, {
      skillId: 'reception.addition-within-5',
      level: 'new',
      correctAttempts: 0,
      totalAttempts: 0,
      score: 0,
    });
    assert.equal(result.nextQuestion.difficulty, 1);
  });

  it('serves the child web interface at the root', async () => {
    const response = await fetch(`${baseUrl}/`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /Who is playing\?/);
  });

  it('resumes an active session rather than creating a second one', async () => {
    const start = async () =>
      (await (
        await fetch(`${baseUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ childId: 'api-resume-child' }),
        })
      ).json()) as { sessionId: string; resumed: boolean };

    const first = await start();
    const second = await start();

    assert.equal(first.resumed, false);
    assert.equal(second.resumed, true);
    assert.equal(second.sessionId, first.sessionId);
  });

  it('completes a session over HTTP and reports the reason', async () => {
    const startResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'api-complete-child' }),
    });
    const session = (await startResponse.json()) as { sessionId: string };

    const completeResponse = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}/complete`,
      { method: 'POST' },
    );

    assert.equal(completeResponse.status, 200);
    const summary = (await completeResponse.json()) as {
      endedReason: string;
      questionsAnswered: number;
    };
    assert.equal(summary.endedReason, 'completed');
    assert.equal(summary.questionsAnswered, 0);

    const stateResponse = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}`,
    );
    const state = (await stateResponse.json()) as { status: string };
    assert.equal(state.status, 'completed');
  });

  it('returns the current session state for resume', async () => {
    const startResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'api-state-child' }),
    });
    const session = (await startResponse.json()) as {
      sessionId: string;
      question: { id: string };
    };

    const stateResponse = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}`,
    );

    assert.equal(stateResponse.status, 200);
    const state = (await stateResponse.json()) as {
      status: string;
      question: { id: string; correctAnswer?: string };
    };
    assert.equal(state.status, 'active');
    assert.equal(state.question.id, session.question.id);
    assert.equal(state.question.correctAnswer, undefined);
  });

  it('returns a safe client error for an unknown session', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/does-not-exist`);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  });

  it('returns a safe client error for invalid input', async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: '' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  });
});
