import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { createDatabase } from '../server/database';

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
    legacy.close();

    const upgraded = createDatabase(filename);
    const mastery = upgraded
      .prepare(
        `SELECT correct_attempts, total_attempts, level
         FROM mastery WHERE child_id = 'existing-child'`,
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
    assert.deepEqual(versions, [{ version: 1 }, { version: 2 }]);
  });
});
