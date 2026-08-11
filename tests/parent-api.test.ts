import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { createApp } from '../server/app';
import { loadConfig, MINIMUM_ADMIN_SECRET_LENGTH } from '../server/config';
import { createDatabase } from '../server/database';
import { ParentService } from '../server/parent-service';
import { TutoringService } from '../server/tutoring-service';

const ADMIN_SECRET = 'a-long-enough-parent-secret';

/**
 * Days 19 and 25 over HTTP: the parent overview an adult actually reads, and
 * the access control in front of it. An unauthenticated caller must learn
 * nothing at all — not even whether a child id exists.
 */
describe('parent API', () => {
  const now = new Date('2026-08-11T09:00:00Z');
  let database: Database.Database;
  let tutor: TutoringService;
  let server: Server;
  let baseUrl: string;

  async function listen(env: NodeJS.ProcessEnv): Promise<void> {
    const config = loadConfig(env);
    const parent = new ParentService(database, tutor, config, { now: () => now });
    await new Promise<void>((resolve, reject) => {
      server = createApp(tutor, { parent, config }).listen(
        0,
        '127.0.0.1',
        (error?: Error) => (error ? reject(error) : resolve()),
      );
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const call = (
    path: string,
    init: RequestInit & { secret?: string } = {},
  ): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.secret ? { 'x-admin-secret': init.secret } : {}),
      },
    });

  beforeEach(() => {
    database = createDatabase(':memory:');
    tutor = new TutoringService(database, { now: () => now });
    tutor.seedInitialContent();
  });

  afterEach(async () => {
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await closed;
    database.close();
  });

  /** One child with a session, an answer, a skip and a safety event. */
  function seedChild(childId: string): { sessionId: string; attemptId: string } {
    const started = tutor.startSession({ childId });
    assert.ok(started.sessionId && started.question);
    const answered = tutor.submitAnswer({
      sessionId: started.sessionId,
      questionId: started.question.id,
      answer: 'definitely wrong',
    });
    assert.ok(answered.nextQuestion);
    tutor.skipQuestion({
      sessionId: started.sessionId,
      questionId: answered.nextQuestion.id,
    });
    database
      .prepare(
        `INSERT INTO safety_events (id, session_id, event_type, reason)
         VALUES (?, ?, 'fallback_used', 'model_unavailable')`,
      )
      .run(`event-${childId}`, started.sessionId);
    const { id } = database
      .prepare(
        `SELECT id FROM attempts WHERE child_id = ? AND outcome = 'answered'`,
      )
      .get(childId) as { id: string };
    return { sessionId: started.sessionId, attemptId: id };
  }

  describe('with an admin secret configured', () => {
    beforeEach(async () => {
      await listen({ HOST: '127.0.0.1', ADMIN_SECRET });
    });

    it('rejects every parent route without the secret', async () => {
      seedChild('child-1');
      const routes: Array<[string, string, unknown?]> = [
        ['GET', '/api/parent/children'],
        ['GET', '/api/parent/children/child-1/overview'],
        ['GET', '/api/parent/children/child-1/export'],
        ['DELETE', '/api/parent/children/child-1', { confirm: 'child-1' }],
        ['GET', '/api/parent/children/child-1/settings'],
        ['PUT', '/api/parent/children/child-1/settings', { dailySessionLimit: 2 }],
        ['POST', '/api/parent/attempts/any/correction', { isCorrect: true, reason: 'x' }],
        ['DELETE', '/api/parent/attempts/any/correction'],
        ['GET', '/api/parent/privacy'],
        ['PUT', '/api/parent/retention', { sessionDays: 1, eventDays: 1 }],
        ['POST', '/api/parent/retention/run'],
        ['POST', '/api/parent/cache/clear'],
      ];

      for (const [method, path, body] of routes) {
        const response = await call(path, {
          method,
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(response.status, 401, `${method} ${path}`);
        assert.deepEqual(await response.json(), { error: 'unauthorized' });
      }

      assert.equal(
        (
          database.prepare('SELECT COUNT(*) AS total FROM children').get() as {
            total: number;
          }
        ).total,
        1,
        'a rejected DELETE never reached the database',
      );
    });

    it('answers the same 401 for a child that exists and one that does not', async () => {
      seedChild('child-real');

      const real = await call('/api/parent/children/child-real/overview');
      const fake = await call('/api/parent/children/child-imaginary/overview');

      assert.equal(real.status, fake.status);
      assert.deepEqual(await real.json(), await fake.json());
    });

    it('rejects a wrong secret and accepts the right one', async () => {
      seedChild('child-2');

      const wrong = await call('/api/parent/children', { secret: 'wrong' });
      assert.equal(wrong.status, 401);

      const right = await call('/api/parent/children', { secret: ADMIN_SECRET });
      assert.equal(right.status, 200);
      const body = (await right.json()) as {
        children: Array<{ childId: string; dailySessionLimit: number }>;
      };
      assert.deepEqual(body.children.map((child) => child.childId), ['child-2']);
      assert.equal(body.children[0].dailySessionLimit, 1);
    });

    it('shows sessions, attempts, mastery and events without model internals', async () => {
      const { sessionId } = seedChild('child-overview');

      const response = await call('/api/parent/children/child-overview/overview', {
        secret: ADMIN_SECRET,
      });

      assert.equal(response.status, 200);
      const overview = (await response.json()) as Record<string, any>;
      assert.equal(overview.sessions.length, 1);
      assert.equal(overview.sessions[0].sessionId, sessionId);
      assert.equal(overview.sessions[0].label, 'Session 1');
      assert.equal(overview.sessions[0].answered, 1);
      assert.equal(overview.sessions[0].skipped, 1);
      assert.equal(overview.attempts.length, 2);
      assert.equal(overview.mastery[0].level, 'learning');
      assert.equal(overview.events.length, 1);
      assert.equal(overview.events[0].eventType, 'fallback_used');
      assert.equal(overview.events[0].sessionNumber, 1);
      assert.equal(overview.settings.dailySessionLimit, 1);
      assert.equal(overview.settings.sessionsToday, 1);
      assert.deepEqual(overview.totals, {
        sessions: 1,
        answered: 1,
        skipped: 1,
        correct: 0,
      });
      assert.doesNotMatch(
        JSON.stringify(overview),
        /correctAnswer|prompt_version|ollama|qwen/i,
        'no answer keys and no model internals in the parent view',
      );
    });

    it('never exposes prompt or model internals on the child route', async () => {
      const started = tutor.startSession({ childId: 'child-clean' });
      assert.ok(started.sessionId);

      const response = await fetch(`${baseUrl}/api/sessions/${started.sessionId}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.doesNotMatch(body, /correctAnswer|promptVersion|provider|model/i);
    });

    it('corrects and reverses an evaluation over HTTP', async () => {
      const { attemptId } = seedChild('child-http-correction');

      const corrected = await call(
        `/api/parent/attempts/${attemptId}/correction`,
        {
          method: 'POST',
          secret: ADMIN_SECRET,
          body: JSON.stringify({ isCorrect: true, reason: 'Mistyped for her' }),
        },
      );
      assert.equal(corrected.status, 200);
      assert.equal(
        ((await corrected.json()) as { mastery: { score: number } }).mastery.score,
        1,
      );

      const reversed = await call(
        `/api/parent/attempts/${attemptId}/correction`,
        { method: 'DELETE', secret: ADMIN_SECRET },
      );
      assert.equal(reversed.status, 200);
      assert.equal(
        ((await reversed.json()) as { mastery: { score: number } }).mastery.score,
        0,
      );
    });

    it('reads and updates the daily session limit', async () => {
      seedChild('child-settings');

      const updated = await call(
        '/api/parent/children/child-settings/settings',
        {
          method: 'PUT',
          secret: ADMIN_SECRET,
          body: JSON.stringify({ dailySessionLimit: 3 }),
        },
      );
      assert.equal(updated.status, 200);
      assert.equal(
        ((await updated.json()) as { dailySessionLimit: number })
          .dailySessionLimit,
        3,
      );

      const rejected = await call(
        '/api/parent/children/child-settings/settings',
        {
          method: 'PUT',
          secret: ADMIN_SECRET,
          body: JSON.stringify({ dailySessionLimit: 99 }),
        },
      );
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { error: 'invalid_request' });
    });

    it('exports, then permanently deletes, a confirmed child', async () => {
      seedChild('child-gone');
      seedChild('child-stays');

      const exported = await call('/api/parent/children/child-gone/export', {
        secret: ADMIN_SECRET,
      });
      assert.equal(exported.status, 200);
      assert.equal(
        ((await exported.json()) as { format: string }).format,
        'ai-family-tutor.child-export',
      );

      const unconfirmed = await call('/api/parent/children/child-gone', {
        method: 'DELETE',
        secret: ADMIN_SECRET,
        body: JSON.stringify({ confirm: 'child-stays' }),
      });
      assert.equal(unconfirmed.status, 400);

      const deleted = await call('/api/parent/children/child-gone', {
        method: 'DELETE',
        secret: ADMIN_SECRET,
        body: JSON.stringify({ confirm: 'child-gone' }),
      });
      assert.equal(deleted.status, 200);

      const remaining = await call('/api/parent/children', {
        secret: ADMIN_SECRET,
      });
      assert.deepEqual(
        ((await remaining.json()) as { children: Array<{ childId: string }> })
          .children.map((child) => child.childId),
        ['child-stays'],
      );
    });

    it('reports the privacy summary, retention and cache clearing', async () => {
      seedChild('child-privacy');

      const privacy = (await (
        await call('/api/parent/privacy', { secret: ADMIN_SECRET })
      ).json()) as Record<string, any>;
      assert.equal(privacy.parentAccess.mode, 'admin-secret');
      assert.equal(privacy.network.lanMode, false);
      assert.doesNotMatch(JSON.stringify(privacy), new RegExp(ADMIN_SECRET));

      const retention = await call('/api/parent/retention', {
        method: 'PUT',
        secret: ADMIN_SECRET,
        body: JSON.stringify({ sessionDays: 30, eventDays: 7 }),
      });
      assert.equal(retention.status, 200);
      assert.deepEqual(await retention.json(), {
        sessionDays: 30,
        eventDays: 7,
        lastRunAt: null,
      });

      const run = await call('/api/parent/retention/run', {
        method: 'POST',
        secret: ADMIN_SECRET,
      });
      assert.equal(run.status, 200);
      assert.equal(
        ((await run.json()) as { ranAt: string }).ranAt,
        now.toISOString(),
      );

      const cleared = await call('/api/parent/cache/clear', {
        method: 'POST',
        secret: ADMIN_SECRET,
      });
      assert.deepEqual(await cleared.json(), { cleared: 0 });
    });

    it('serves the parent page as static content', async () => {
      const response = await fetch(`${baseUrl}/parent.html`);

      assert.equal(response.status, 200);
      assert.match(await response.text(), /Parent controls/i);
    });
  });

  describe('with no admin secret on a loopback bind', () => {
    beforeEach(async () => {
      await listen({ HOST: '127.0.0.1' });
    });

    it('allows the parent routes and says so in the privacy summary', async () => {
      seedChild('child-open');

      const response = await call('/api/parent/children');
      assert.equal(response.status, 200);

      const privacy = (await (await call('/api/parent/privacy')).json()) as {
        parentAccess: { mode: string; detail: string };
      };
      assert.equal(privacy.parentAccess.mode, 'open-loopback');
      assert.match(privacy.parentAccess.detail, /anyone using this machine/i);
    });
  });
});

describe('network configuration', () => {
  it('binds to loopback by default', () => {
    const config = loadConfig({});

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.lanMode, false);
    assert.equal(config.parentAccess, 'open-loopback');
  });

  it('refuses to start in LAN mode without an admin secret', () => {
    assert.throws(
      () => loadConfig({ HOST: '0.0.0.0' }),
      /ADMIN_SECRET/,
      'a LAN bind with no secret must not boot',
    );
    assert.throws(
      () => loadConfig({ HOST: '192.168.1.20', ADMIN_SECRET: '   ' }),
      /ADMIN_SECRET/,
      'a blank secret is a mistake, not a secret',
    );
  });

  it('refuses a LAN admin secret that is too short to matter', () => {
    assert.throws(
      () =>
        loadConfig({
          HOST: '192.168.1.20',
          ADMIN_SECRET: 'x'.repeat(MINIMUM_ADMIN_SECRET_LENGTH - 1),
        }),
      /at least/,
    );

    const config = loadConfig({
      HOST: '192.168.1.20',
      ADMIN_SECRET: 'x'.repeat(MINIMUM_ADMIN_SECRET_LENGTH),
    });
    assert.equal(config.lanMode, true);
    assert.equal(config.parentAccess, 'admin-secret');
  });

  it('treats every loopback spelling as local', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', 'LOCALHOST']) {
      assert.equal(loadConfig({ HOST: host }).lanMode, false, host);
    }
  });
});
