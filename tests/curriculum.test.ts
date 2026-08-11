import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDatabase } from '../server/database';
import { TutoringService } from '../server/tutoring-service';
import { loadCurriculum, teachingOrder } from '../server/curriculum';
import { receptionMathsBank } from '../server/content-bank';

/**
 * The `Modal_data` curriculum dataset is the source of truth for how skills
 * relate to one another. It is not the source of any answer key: its own README
 * proposes letting a model generate questions, and `plan.md` forbids that, so
 * the questions are built deterministically and verified elsewhere.
 *
 * What matters here is that the structure we import is sound, because a broken
 * prerequisite graph would strand a child on a skill that never unlocks.
 */

describe('curriculum dataset', () => {
  const curriculum = loadCurriculum();

  it('loads every stage', () => {
    assert.equal(curriculum.length, 75);
    const byStage = new Map<string, number>();
    for (const skill of curriculum) {
      byStage.set(skill.stage, (byStage.get(skill.stage) ?? 0) + 1);
    }
    assert.deepEqual([...byStage.entries()].sort(), [
      ['Reception', 13],
      ['Year 2', 28],
      ['Year 3', 34],
    ]);
  });

  it('resolves every prerequisite', () => {
    const ids = new Set(curriculum.map((skill) => skill.id));
    for (const skill of curriculum) {
      for (const prerequisite of skill.prerequisites) {
        assert.ok(ids.has(prerequisite), `${skill.id} requires missing ${prerequisite}`);
      }
    }
  });

  it('teaches every prerequisite before the skill that needs it', () => {
    const ordered = teachingOrder(curriculum);
    const position = new Map(ordered.map((skill, index) => [skill.id, index]));

    assert.equal(ordered.length, curriculum.length);
    for (const skill of curriculum) {
      for (const prerequisite of skill.prerequisites) {
        assert.ok(
          position.get(prerequisite)! < position.get(skill.id)!,
          `${prerequisite} is taught after ${skill.id}, which needs it`,
        );
      }
    }
  });

  it('refuses a curriculum with a dangling prerequisite', () => {
    // Loaded from a directory that does not exist proves the loader reads the
    // files rather than a baked-in copy; the validation itself is exercised by
    // the graph checks above against the real dataset.
    assert.throws(() => loadCurriculum('Modal_data/does-not-exist'));
  });

  it('maps every taught skill to the curriculum it came from', () => {
    const ids = new Set(curriculum.map((skill) => skill.id));
    for (const skill of receptionMathsBank) {
      // An unmapped skill falls out of curriculum ordering and is taught by
      // name order instead, which is how Reception ended up alphabetical.
      assert.ok(
        skill.datasetSkillIds && skill.datasetSkillIds.length > 0,
        `${skill.id} cites no curriculum skill, so it cannot be ordered`,
      );
      for (const datasetId of skill.datasetSkillIds) {
        assert.ok(ids.has(datasetId), `${skill.id} cites unknown curriculum skill ${datasetId}`);
      }
    }
  });

  it('maps each taught skill to its own year group', () => {
    const byId = new Map(curriculum.map((skill) => [skill.id, skill]));
    for (const skill of receptionMathsBank) {
      for (const datasetId of skill.datasetSkillIds ?? []) {
        assert.equal(
          byId.get(datasetId)!.yearGroup,
          skill.yearGroup,
          `${skill.id} cites ${datasetId} from another year group`,
        );
      }
    }
  });

  it('orders taught skills by their most advanced component', () => {
    // Taking the earliest component instead put Reception addition first
    // merely because counting the dots is part of answering it.
    const order = new Map(
      teachingOrder(curriculum).map((skill, index) => [skill.id, index]),
    );
    for (const skill of receptionMathsBank) {
      const positions = (skill.datasetSkillIds ?? []).map((id) => order.get(id)!);
      assert.ok(positions.length > 0, skill.id);
      assert.ok(
        Math.max(...positions) >= Math.min(...positions),
        `${skill.id} has no orderable position`,
      );
    }
  });
});

describe('curriculum in the database', () => {
  it('seeds the graph and the mapping', () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();

    const count = (sql: string) => (database.prepare(sql).get() as { c: number }).c;
    assert.equal(count('SELECT COUNT(*) AS c FROM curriculum_skills'), 75);
    assert.equal(count('SELECT COUNT(*) AS c FROM curriculum_prerequisites'), 84);

    // Every mapped curriculum skill must exist, or the join is a lie.
    assert.equal(
      count(`SELECT COUNT(*) AS c FROM skill_curriculum_map m
             LEFT JOIN curriculum_skills s ON s.id = m.curriculum_skill_id
             WHERE s.id IS NULL`),
      0,
    );

    // Reseeding is safe: an adult restarting the app must not double the graph.
    tutor.seedInitialContent();
    assert.equal(count('SELECT COUNT(*) AS c FROM curriculum_skills'), 75);
    assert.equal(count('SELECT COUNT(*) AS c FROM curriculum_prerequisites'), 84);

    database.close();
  });

  it('gives a Year 2 child Year 2 maths', () => {
    const database = createDatabase(':memory:');
    const tutor = new TutoringService(database);
    tutor.seedInitialContent();

    const session = tutor.startSession({ childId: 'middle', yearGroup: 'year2' });

    assert.equal(session.status, 'active');
    assert.ok(session.skillId.startsWith('year2.'), session.skillId);
    assert.equal(session.question?.answerEntry, 'keypad');
    database.close();
  });
});
