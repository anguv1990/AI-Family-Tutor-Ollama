import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { createDatabase } from '../server/database';
import { migrations } from '../server/database';

/**
 * Derived from the migration set rather than written out, so adding a
 * migration does not silently require editing an unrelated assertion.
 */
function expectedVersions(): Array<{ version: number }> {
  return migrations.map((migration) => ({ version: migration.version }));
}

describe('database migrations', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('upgrades an existing version 1 database without losing mastery data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'family-tutor-'));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, 'tutor.sqlite');
    const legacy = new Database(filename);
    legacy.exec(
      fs.readFileSync(
        path.resolve(process.cwd(), 'db/migrations/create_tables.sql'),
        'utf8',
      ),
    );
    legacy.prepare('INSERT INTO children (id) VALUES (?)').run('existing-child');
    legacy
      .prepare(
        `INSERT INTO skills (id, title, curriculum_version, enabled)
         VALUES ('existing-skill', 'Existing skill', 'v1', 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO mastery
           (child_id, skill_id, correct_attempts, total_attempts, score)
         VALUES ('existing-child', 'existing-skill', 1, 1, 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO sessions (id, child_id, started_at, ended_at)
         VALUES ('finished-session', 'existing-child',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO sessions (id, child_id) VALUES ('open-session', 'existing-child')`,
      )
      .run();
    legacy.close();

    const upgraded = createDatabase(filename);
    const mastery = upgraded
      .prepare(
        `SELECT correct_attempts, total_attempts, level
         FROM mastery WHERE child_id = 'existing-child'`,
      )
      .get();
    const sessions = upgraded
      .prepare('SELECT id, ended_reason, skill_id FROM sessions ORDER BY id')
      .all();
    const provenance = upgraded
      .prepare(
        `SELECT COUNT(*) AS total FROM content_templates
         WHERE source = '' OR licence = ''`,
      )
      .get();
    const versions = upgraded
      .prepare('SELECT version FROM schema_versions ORDER BY version')
      .all();
    upgraded.close();

    assert.deepEqual(mastery, {
      correct_attempts: 1,
      total_attempts: 1,
      level: 'learning',
    });
    assert.deepEqual(
      sessions,
      [
        {
          id: 'finished-session',
          ended_reason: 'exhausted',
          skill_id: 'reception.addition-within-5',
        },
        {
          id: 'open-session',
          ended_reason: null,
          skill_id: 'reception.addition-within-5',
        },
      ],
      'already-ended sessions backfill to exhausted; open sessions stay open ' +
        'and every legacy session adopts the original skill',
    );
    assert.deepEqual(
      provenance,
      { total: 0 },
      'pre-existing templates are attributed rather than left blank',
    );
    assert.deepEqual(versions, expectedVersions());
  });

  it('widens the ended-reason constraint on a version 4 database with live sessions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'family-tutor-v4-'));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, 'tutor.sqlite');

    const legacy = new Database(filename);
    for (const [version, migration] of [
      [1, 'create_tables.sql'],
      [2, '002_mastery_levels.sql'],
      [3, '003_session_completion.sql'],
      [4, '004_content_provenance.sql'],
    ] as Array<[number, string]>) {
      legacy.exec(
        fs.readFileSync(
          path.resolve(process.cwd(), 'db/migrations', migration),
          'utf8',
        ),
      );
      legacy
        .prepare('INSERT OR IGNORE INTO schema_versions (version) VALUES (?)')
        .run(version);
    }
    legacy.prepare('INSERT INTO children (id) VALUES (?)').run('v4-child');
    legacy
      .prepare(
        `INSERT INTO skills (id, title, curriculum_version, enabled)
         VALUES ('v4-skill', 'Legacy skill', 'v1', 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO content_templates
           (id, skill_id, version, prompt, correct_answer, difficulty, reviewed, enabled)
         VALUES ('v4-template', 'v4-skill', 1, 'What is 1 + 1?', '2', 1, 1, 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO sessions
           (id, child_id, skill_id, current_question_id, started_at, ended_at, ended_reason)
         VALUES ('v4-ended', 'v4-child', 'v4-skill', NULL,
                 '2026-08-01 09:00:00', '2026-08-01 09:08:00', 'completed')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO sessions (id, child_id, skill_id, current_question_id, started_at)
         VALUES ('v4-open', 'v4-child', 'v4-skill', 'v4-template', '2026-08-01 10:00:00')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO attempts
           (id, session_id, child_id, template_id, template_version, answer,
            is_correct, created_at)
         VALUES ('v4-attempt', 'v4-ended', 'v4-child', 'v4-template', 1, '2', 1,
                 '2026-08-01 09:01:00')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO safety_events (id, session_id, event_type)
         VALUES ('v4-event', 'v4-ended', 'review')`,
      )
      .run();
    legacy.close();

    const upgraded = createDatabase(filename);

    // Rebuilding sessions drops the table, and a dropped parent cascades its
    // children away unless the rebuild suspends foreign keys. This is the
    // assertion that catches that.
    assert.deepEqual(
      upgraded.prepare('SELECT id, session_id FROM attempts').all(),
      [{ id: 'v4-attempt', session_id: 'v4-ended' }],
      'attempts survive the sessions table rebuild',
    );
    assert.deepEqual(
      upgraded.prepare('SELECT id, session_id FROM safety_events').all(),
      [{ id: 'v4-event', session_id: 'v4-ended' }],
    );
    assert.deepEqual(
      upgraded
        .prepare(
          `SELECT id, skill_id, current_question_id, started_at, ended_at, ended_reason
           FROM sessions ORDER BY id`,
        )
        .all(),
      [
        {
          id: 'v4-ended',
          skill_id: 'v4-skill',
          current_question_id: null,
          started_at: '2026-08-01 09:00:00',
          ended_at: '2026-08-01 09:08:00',
          ended_reason: 'completed',
        },
        {
          id: 'v4-open',
          skill_id: 'v4-skill',
          current_question_id: 'v4-template',
          started_at: '2026-08-01 10:00:00',
          ended_at: null,
          ended_reason: null,
        },
      ],
      'every column survives the rebuild and open sessions stay open',
    );

    for (const reason of ['question_limit', 'time_limit']) {
      upgraded
        .prepare('UPDATE sessions SET ended_reason = ? WHERE id = ?')
        .run(reason, 'v4-open');
    }
    assert.throws(
      () =>
        upgraded
          .prepare('UPDATE sessions SET ended_reason = ? WHERE id = ?')
          .run('anything', 'v4-open'),
      /CHECK constraint failed/,
      'the widened constraint still rejects unknown reasons',
    );
    assert.equal(
      (upgraded.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0]
        .foreign_keys,
      1,
      'foreign keys are switched back on after the rebuild',
    );
    assert.deepEqual(upgraded.pragma('foreign_key_check'), []);
    assert.deepEqual(
      upgraded.prepare('SELECT version FROM schema_versions ORDER BY version').all(),
      expectedVersions(),
    );
    upgraded.close();
  });
});
