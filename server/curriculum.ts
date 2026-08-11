import fs from 'node:fs';
import path from 'node:path';
import type { YearGroup } from './content-bank';

/**
 * The UK maths curriculum dataset in `Modal_data/` — 75 skills across
 * Reception, Year 2 and Year 3, with prerequisites, misconceptions and
 * generation bounds.
 *
 * The dataset's own README proposes letting a model generate questions inside
 * each skill's bounds. This application deliberately does not: `plan.md`
 * requires adult-reviewed content and forbids the model being the source of
 * correctness, and the risk register rates a subtly wrong answer key as high
 * impact. So the dataset is used for what it is uniquely good at — curriculum
 * structure, ordering and diagnosis — while the questions themselves are built
 * deterministically in `content-bank.ts`, where every answer is computed
 * arithmetically and re-derived independently by tests.
 */

export type CurriculumStage = 'Reception' | 'Year 2' | 'Year 3';

export type Misconception = { pattern: string; response: string };

export type CurriculumSkill = {
  id: string;
  stage: CurriculumStage;
  yearGroup: YearGroup;
  domain: string;
  topic: string;
  learningObjective: string;
  prerequisites: string[];
  difficulty: number;
  vocabulary: string[];
  misconceptions: Misconception[];
  questionGeneration: Record<string, unknown>;
};

const STAGE_TO_YEAR_GROUP: Record<CurriculumStage, YearGroup> = {
  Reception: 'reception',
  'Year 2': 'year2',
  'Year 3': 'year3',
};

const DATASET_ROOT = 'Modal_data/Maths/uk_math_ai_tutor_v1';

const CURRICULUM_FILES = [
  'curriculum/reception_math.json',
  'curriculum/year2_math.json',
  'curriculum/year3_math.json',
];

type RawSkill = {
  id: string;
  stage: string;
  domain: string;
  topic: string;
  learning_objective: string;
  prerequisites?: string[];
  difficulty?: number;
  vocabulary?: string[];
  misconceptions?: Misconception[];
  question_generation?: Record<string, unknown>;
};

let cached: CurriculumSkill[] | undefined;

/**
 * Loaded once and validated hard. A curriculum with a dangling prerequisite or
 * a cycle would strand a child on a skill that can never unlock, so it fails at
 * startup rather than at the moment a child is waiting for a question.
 */
export function loadCurriculum(root = DATASET_ROOT): CurriculumSkill[] {
  if (cached && root === DATASET_ROOT) return cached;

  const skills: CurriculumSkill[] = [];
  for (const file of CURRICULUM_FILES) {
    const full = path.resolve(process.cwd(), root, file);
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8')) as { skills: RawSkill[] };
    for (const raw of parsed.skills) {
      const stage = raw.stage as CurriculumStage;
      const yearGroup = STAGE_TO_YEAR_GROUP[stage];
      if (!yearGroup) throw new Error(`Unknown curriculum stage "${raw.stage}" on ${raw.id}`);
      skills.push({
        id: raw.id,
        stage,
        yearGroup,
        domain: raw.domain,
        topic: raw.topic,
        learningObjective: raw.learning_objective,
        prerequisites: raw.prerequisites ?? [],
        difficulty: raw.difficulty ?? 1,
        vocabulary: raw.vocabulary ?? [],
        misconceptions: raw.misconceptions ?? [],
        questionGeneration: raw.question_generation ?? {},
      });
    }
  }

  assertUsable(skills);
  if (root === DATASET_ROOT) cached = skills;
  return skills;
}

function assertUsable(skills: CurriculumSkill[]): void {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  if (byId.size !== skills.length) {
    throw new Error('Curriculum contains duplicate skill ids');
  }

  for (const skill of skills) {
    for (const prerequisite of skill.prerequisites) {
      if (!byId.has(prerequisite)) {
        throw new Error(`${skill.id} requires unknown skill ${prerequisite}`);
      }
    }
  }

  // A cycle means no skill in it can ever become available.
  const state = new Map<string, 'open' | 'done'>();
  const walk = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      throw new Error(`Curriculum prerequisites form a cycle: ${[...trail, id].join(' -> ')}`);
    }
    state.set(id, 'open');
    for (const prerequisite of byId.get(id)!.prerequisites) {
      walk(prerequisite, [...trail, id]);
    }
    state.set(id, 'done');
  };
  for (const skill of skills) walk(skill.id, []);
}

/** Curriculum order: prerequisites first, then the dataset's own difficulty. */
export function teachingOrder(skills: CurriculumSkill[]): CurriculumSkill[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const placed = new Set<string>();
  const ordered: CurriculumSkill[] = [];

  const place = (skill: CurriculumSkill): void => {
    if (placed.has(skill.id)) return;
    placed.add(skill.id);
    for (const prerequisite of skill.prerequisites) {
      const parent = byId.get(prerequisite);
      if (parent) place(parent);
    }
    ordered.push(skill);
  };

  for (const skill of [...skills].sort(
    (a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id),
  )) {
    place(skill);
  }
  return ordered;
}
