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

  it('reports the question limit to the client and refuses further answers', async () => {
    const startResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'api-limit-child' }),
    });
    const session = (await startResponse.json()) as {
      sessionId: string;
      question: { id: string };
    };
    const answerKeyFor = (templateId: string): string =>
      (
        database
          .prepare('SELECT correct_answer FROM content_templates WHERE id = ?')
          .get(templateId) as { correct_answer: string }
      ).correct_answer;

    let questionId = session.question.id;
    let result!: {
      status: string;
      nextQuestion: { id: string } | null;
    };
    for (let answered = 0; answered < 8; answered += 1) {
      const response = await fetch(
        `${baseUrl}/api/sessions/${session.sessionId}/answers`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            questionId,
            answer: answerKeyFor(questionId),
          }),
        },
      );
      assert.equal(response.status, 200);
      result = (await response.json()) as typeof result;
      if (result.nextQuestion) questionId = result.nextQuestion.id;
    }

    assert.equal(result.status, 'question_limit');
    assert.equal(result.nextQuestion, null);

    const stateResponse = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}`,
    );
    const state = (await stateResponse.json()) as {
      status: string;
      question: unknown;
    };
    assert.equal(state.status, 'question_limit');
    assert.equal(state.question, null);

    const rejected = await fetch(
      `${baseUrl}/api/sessions/${session.sessionId}/answers`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId, answer: '2' }),
      },
    );
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: 'invalid_request' });
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

  /**
   * A child who has already practised today, or who has worked through a whole
   * skill, has done nothing wrong. Answering 4xx would make the UI show a
   * four-year-old an error for using the app exactly as intended.
   */
  it('reports the daily cap as a 200 state rather than an error', async () => {
    const start = () =>
      fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ childId: 'api-capped-child' }),
      });

    // The cap counts practised sittings, so answering is what spends the day.
    database
      .prepare(
        `INSERT INTO children (id, daily_session_limit) VALUES ('api-capped-child', 1)
         ON CONFLICT (id) DO UPDATE SET daily_session_limit = 1`,
      )
      .run();

    const first = await start();
    assert.equal(first.status, 201);
    const started = (await first.json()) as {
      status: string;
      sessionId: string;
      question: { id: string };
    };
    assert.equal(started.status, 'active');
    await fetch(`${baseUrl}/api/sessions/${started.sessionId}/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: started.question.id, answer: '0' }),
    });
    await fetch(`${baseUrl}/api/sessions/${started.sessionId}/complete`, {
      method: 'POST',
    });

    const second = await start();

    assert.equal(second.status, 200);
    const body = (await second.json()) as {
      status: string;
      sessionId: null;
      question: null;
      message: string;
      mastery: { level: string; totalAttempts: number };
    };
    assert.equal(body.status, 'daily_limit');
    assert.equal(body.sessionId, null);
    assert.equal(body.question, null);
    assert.ok(body.message.length > 0);
    // The capped response still reports real mastery, so a parent looking at
    // the day can see what was practised before the cap stopped it.
    assert.equal(body.mastery.level, 'learning');
    assert.equal(body.mastery.totalAttempts, 1);
  });

  it('reports an empty question bank as a 200 exhausted state', async () => {
    database.prepare('UPDATE content_templates SET enabled = 0').run();

    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childId: 'api-nothing-child' }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      status: string;
      question: null;
      message: string;
    };
    assert.equal(body.status, 'exhausted');
    assert.equal(body.question, null);
    assert.ok(body.message.length > 0);
  });
});
