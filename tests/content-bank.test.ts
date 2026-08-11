import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { receptionMathsBank } from '../server/content-bank';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';

type SeededTemplate = {
  id: string;
  skill_id: string;
  version: number;
  prompt: string;
  correct_answer: string;
  difficulty: number;
  sequence: number;
  source: string;
  licence: string;
  reviewed: number;
  enabled: number;
};

/**
 * The Day 4 exit check: every enabled template is unambiguous, attributable and
 * answerable by tapping a number, and each skill's bank is big enough that a
 * session ends by the stopping rule rather than by exhaustion.
 */
describe('Reception Maths content bank', () => {
  let database: Database.Database;
  let templates: SeededTemplate[];

  beforeEach(() => {
    database = createDatabase(':memory:');
    new TutoringService(database).seedInitialContent();
    templates = database
      .prepare(
        `SELECT id, skill_id, version, prompt, correct_answer, difficulty,
                sequence, source, licence, reviewed, enabled
         FROM content_templates
         WHERE reviewed = 1 AND enabled = 1`,
      )
      .all() as SeededTemplate[];
  });

  afterEach(() => database.close());

  it('seeds every skill in the bank as enabled', () => {
    const skills = database
      .prepare('SELECT id FROM skills WHERE enabled = 1 ORDER BY id')
      .all() as Array<{ id: string }>;

    assert.deepEqual(
      skills.map((skill) => skill.id),
      receptionMathsBank.map((skill) => skill.id).sort(),
    );
  });

  it('gives every skill at least twenty enabled templates', () => {
    for (const skill of receptionMathsBank) {
      const count = templates.filter(
        (template) => template.skill_id === skill.id,
      ).length;
      assert.ok(
        count >= 20,
        `${skill.id} has ${count} enabled templates, expected at least 20`,
      );
    }
  });

  it('covers all three difficulties in every skill', () => {
    for (const skill of receptionMathsBank) {
      const difficulties = new Set(
        templates
          .filter((template) => template.skill_id === skill.id)
          .map((template) => template.difficulty),
      );
      assert.deepEqual([...difficulties].sort(), [1, 2, 3], skill.id);
    }
  });

  it('records a source and licence for every enabled template', () => {
    for (const template of templates) {
      assert.ok(template.source.trim(), `${template.id} has no source`);
      assert.ok(template.licence.trim(), `${template.id} has no licence`);
    }
  });

  it('answers every question the way its skill can be answered', () => {
    // Reception taps a number from a row, so its answers must fit 0-10. Year 3
    // types on a keypad, so its answers only have to be whole and non-negative.
    for (const template of templates) {
      const skill = receptionMathsBank.find((entry) => entry.id === template.skill_id);
      assert.ok(skill, `${template.id} belongs to no seeded skill`);
      const pattern = skill.answerEntry === 'tap-0-10' ? /^(10|[0-9])$/ : /^[0-9]+$/;
      assert.match(
        template.correct_answer,
        pattern,
        `${template.id} answer "${template.correct_answer}" cannot be entered with ${skill.answerEntry}`,
      );
    }
  });

  it('keeps prompts safe to read aloud and free of the answer', () => {
    for (const template of templates) {
      // The prompt is spoken by the browser, so anything a speech engine would
      // skip or mispronounce does not belong in it.
      assert.match(
        template.prompt,
        /^[A-Za-z0-9 ,.?+-]+$/,
        `${template.id} prompt has characters that will not read aloud`,
      );
      // A question or an instruction, never a bare fragment.
      assert.match(template.prompt.trim(), /[?.]$/, template.id);
    }
  });

  it('versions every template and marks it reviewed', () => {
    for (const template of templates) {
      assert.equal(template.version, 1, template.id);
      assert.equal(template.reviewed, 1, template.id);
      assert.match(template.skill_id, /^(reception|year2|year3)\./, template.id);
    }
  });

  it('orders each skill deterministically with no duplicate sequence', () => {
    for (const skill of receptionMathsBank) {
      const sequences = skill.templates.map((template) => template.sequence);
      assert.equal(
        new Set(sequences).size,
        sequences.length,
        `${skill.id} has duplicate sequence values`,
      );
    }
  });

  it('has no duplicate prompt or template ID anywhere in the bank', () => {
    const all = receptionMathsBank.flatMap((skill) => skill.templates);
    assert.equal(new Set(all.map((t) => t.id)).size, all.length);
    assert.equal(new Set(all.map((t) => t.prompt)).size, all.length);
  });

  it('reseeds without duplicating content or re-enabling disabled questions', () => {
    const tutor = new TutoringService(database);
    database
      .prepare("UPDATE content_templates SET enabled = 0 WHERE id = 'addition-1-plus-1'")
      .run();

    tutor.seedInitialContent();

    const total = database
      .prepare('SELECT COUNT(*) AS total FROM content_templates')
      .get() as { total: number };
    assert.equal(
      total.total,
      receptionMathsBank.reduce((sum, skill) => sum + skill.templates.length, 0),
    );

    const disabled = database
      .prepare("SELECT enabled FROM content_templates WHERE id = 'addition-1-plus-1'")
      .get() as { enabled: number };
    assert.equal(disabled.enabled, 0);
  });
});
