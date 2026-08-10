import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  calculateMastery,
  type MasteryLevel,
} from './mastery';

const INITIAL_SKILL_ID = 'reception.addition-within-5';

type PublicQuestion = {
  id: string;
  skillId: string;
  prompt: string;
  difficulty: number;
};

type QuestionRow = {
  id: string;
  skill_id: string;
  version: number;
  prompt: string;
  correct_answer: string;
  difficulty: number;
};

type Mastery = {
  skillId: string;
  level: MasteryLevel;
  correctAttempts: number;
  totalAttempts: number;
  score: number;
};

export class TutoringService {
  constructor(private readonly database: Database.Database) {}

  seedInitialContent(): void {
    const seed = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO skills
             (id, title, curriculum_version, enabled)
           VALUES (?, ?, ?, 1)`,
        )
        .run(INITIAL_SKILL_ID, 'Addition within 5', 'reception-maths-v1');

      const insertTemplate = this.database.prepare(
        `INSERT OR IGNORE INTO content_templates
           (id, skill_id, version, prompt, correct_answer, difficulty, reviewed, enabled)
         VALUES (?, ?, 1, ?, ?, ?, 1, 1)`,
      );

      insertTemplate.run('addition-1-plus-1', INITIAL_SKILL_ID, 'What is 1 + 1?', '2', 1);
      insertTemplate.run('addition-2-plus-1', INITIAL_SKILL_ID, 'What is 2 + 1?', '3', 1);
      insertTemplate.run('addition-2-plus-2', INITIAL_SKILL_ID, 'What is 2 + 2?', '4', 2);
      insertTemplate.run('addition-3-plus-1', INITIAL_SKILL_ID, 'What is 3 + 1?', '4', 2);
      insertTemplate.run('addition-3-plus-2', INITIAL_SKILL_ID, 'What is 3 + 2?', '5', 2);
      insertTemplate.run('addition-4-plus-1', INITIAL_SKILL_ID, 'What is 4 + 1?', '5', 3);
      insertTemplate.run('addition-5-plus-0', INITIAL_SKILL_ID, 'What is 5 + 0?', '5', 3);
    });

    seed();
  }

  startSession(input: { childId: string }): {
    sessionId: string;
    childId: string;
    question: PublicQuestion;
  } {
    if (!input.childId.trim()) throw new Error('childId is required');

    const sessionId = randomUUID();
    const currentMastery = this.getMastery(input.childId, INITIAL_SKILL_ID);
    const question = this.selectNextQuestion(sessionId, currentMastery.level);
    if (!question) throw new Error('No reviewed questions are available');

    const create = this.database.transaction(() => {
      this.database
        .prepare('INSERT OR IGNORE INTO children (id) VALUES (?)')
        .run(input.childId);
      this.database
        .prepare(
          `INSERT INTO sessions (id, child_id, current_question_id)
           VALUES (?, ?, ?)`,
        )
        .run(sessionId, input.childId, question.id);
    });
    create();

    return {
      sessionId,
      childId: input.childId,
      question: this.toPublicQuestion(question),
    };
  }

  submitAnswer(input: {
    sessionId: string;
    questionId: string;
    answer: string;
  }): {
    correct: boolean;
    mastery: Mastery;
    nextQuestion: PublicQuestion | null;
  } {
    const normalizedAnswer = input.answer.trim();
    if (!normalizedAnswer) throw new Error('answer is required');

    const duplicate = this.database
      .prepare(
        'SELECT 1 FROM attempts WHERE session_id = ? AND template_id = ?',
      )
      .get(input.sessionId, input.questionId);
    if (duplicate) throw new Error('This question has already been answered');

    const session = this.database
      .prepare(
        `SELECT child_id, current_question_id, ended_at
         FROM sessions WHERE id = ?`,
      )
      .get(input.sessionId) as
      | { child_id: string; current_question_id: string | null; ended_at: string | null }
      | undefined;
    if (!session || session.ended_at) throw new Error('Active session not found');
    if (session.current_question_id !== input.questionId) {
      throw new Error('Question is not active for this session');
    }

    const question = this.getReviewedQuestion(input.questionId);

    const correct = normalizedAnswer === question.correct_answer;

    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO attempts
             (id, session_id, child_id, template_id, template_version, answer, is_correct)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.sessionId,
          session.child_id,
          question.id,
          question.version,
          normalizedAnswer,
          correct ? 1 : 0,
        );

      const mastery = this.recalculateMastery(
        session.child_id,
        question.skill_id,
      );
      const next = this.selectNextQuestion(input.sessionId, mastery.level);
      this.database
        .prepare(
          `UPDATE sessions
           SET current_question_id = ?,
               ended_at = CASE WHEN ? IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END
           WHERE id = ?`,
        )
        .run(next?.id ?? null, next?.id ?? null, input.sessionId);

      return {
        correct,
        mastery,
        nextQuestion: next ? this.toPublicQuestion(next) : null,
      };
    })();
  }

  skipQuestion(input: {
    sessionId: string;
    questionId: string;
  }): { mastery: Mastery; nextQuestion: PublicQuestion | null } {
    const duplicate = this.database
      .prepare(
        'SELECT 1 FROM attempts WHERE session_id = ? AND template_id = ?',
      )
      .get(input.sessionId, input.questionId);
    if (duplicate) throw new Error('This question has already been answered');

    const session = this.getActiveSession(input.sessionId, input.questionId);
    const question = this.getReviewedQuestion(input.questionId);

    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO attempts
             (id, session_id, child_id, template_id, template_version,
              answer, is_correct, outcome)
           VALUES (?, ?, ?, ?, ?, '', 0, 'skipped')`,
        )
        .run(
          randomUUID(),
          input.sessionId,
          session.child_id,
          question.id,
          question.version,
        );

      const mastery = this.getMastery(session.child_id, question.skill_id);
      const next = this.selectNextQuestion(input.sessionId, mastery.level);
      this.moveSessionToQuestion(input.sessionId, next);
      return {
        mastery,
        nextQuestion: next ? this.toPublicQuestion(next) : null,
      };
    })();
  }

  private selectNextQuestion(
    sessionId: string,
    level: MasteryLevel,
  ): QuestionRow | undefined {
    const targetDifficulty = { new: 1, learning: 2, secure: 3 }[level];
    return this.database
      .prepare(
        `SELECT t.id, t.skill_id, t.version, t.prompt, t.correct_answer,
                t.difficulty
         FROM content_templates t
         JOIN skills s ON s.id = t.skill_id
         WHERE t.reviewed = 1
           AND t.enabled = 1
           AND s.enabled = 1
           AND NOT EXISTS (
             SELECT 1 FROM attempts a
             WHERE a.session_id = ? AND a.template_id = t.id
           )
         ORDER BY ABS(t.difficulty - ?), t.id
         LIMIT 1`,
      )
      .get(sessionId, targetDifficulty) as QuestionRow | undefined;
  }

  private getActiveSession(
    sessionId: string,
    questionId: string,
  ): { child_id: string } {
    const session = this.database
      .prepare(
        `SELECT child_id, current_question_id, ended_at
         FROM sessions WHERE id = ?`,
      )
      .get(sessionId) as
      | { child_id: string; current_question_id: string | null; ended_at: string | null }
      | undefined;
    if (!session || session.ended_at) throw new Error('Active session not found');
    if (session.current_question_id !== questionId) {
      throw new Error('Question is not active for this session');
    }
    return { child_id: session.child_id };
  }

  private getReviewedQuestion(questionId: string): QuestionRow {
    const question = this.database
      .prepare(
        `SELECT id, skill_id, version, prompt, correct_answer, difficulty
         FROM content_templates
         WHERE id = ? AND reviewed = 1 AND enabled = 1`,
      )
      .get(questionId) as QuestionRow | undefined;
    if (!question) throw new Error('Reviewed question not found');
    return question;
  }

  private getMastery(childId: string, skillId: string): Mastery {
    const stored = this.database
      .prepare(
        `SELECT level, correct_attempts, total_attempts, score
         FROM mastery WHERE child_id = ? AND skill_id = ?`,
      )
      .get(childId, skillId) as
      | {
          level: MasteryLevel;
          correct_attempts: number;
          total_attempts: number;
          score: number;
        }
      | undefined;
    return {
      skillId,
      level: stored?.level ?? 'new',
      correctAttempts: stored?.correct_attempts ?? 0,
      totalAttempts: stored?.total_attempts ?? 0,
      score: stored?.score ?? 0,
    };
  }

  private recalculateMastery(childId: string, skillId: string): Mastery {
    const previous = this.getMastery(childId, skillId);
    const results = this.database
      .prepare(
        `SELECT a.is_correct
         FROM attempts a
         JOIN content_templates t ON t.id = a.template_id
         WHERE a.child_id = ? AND t.skill_id = ? AND a.outcome = 'answered'
         ORDER BY a.created_at, a.rowid`,
      )
      .all(childId, skillId) as Array<{ is_correct: number }>;
    const calculated = calculateMastery(
      results.map((result) => result.is_correct === 1),
      previous.level,
    );

    this.database
      .prepare(
        `INSERT INTO mastery
           (child_id, skill_id, level, correct_attempts, total_attempts,
            score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (child_id, skill_id) DO UPDATE SET
           level = excluded.level,
           correct_attempts = excluded.correct_attempts,
           total_attempts = excluded.total_attempts,
           score = excluded.score,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        childId,
        skillId,
        calculated.level,
        calculated.correctAttempts,
        calculated.totalAttempts,
        calculated.score,
      );
    return { skillId, ...calculated };
  }

  private moveSessionToQuestion(
    sessionId: string,
    next: QuestionRow | undefined,
  ): void {
    this.database
      .prepare(
        `UPDATE sessions
         SET current_question_id = ?,
             ended_at = CASE WHEN ? IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = ?`,
      )
      .run(next?.id ?? null, next?.id ?? null, sessionId);
  }

  private toPublicQuestion(question: QuestionRow): PublicQuestion {
    return {
      id: question.id,
      skillId: question.skill_id,
      prompt: question.prompt,
      difficulty: question.difficulty,
    };
  }
}
