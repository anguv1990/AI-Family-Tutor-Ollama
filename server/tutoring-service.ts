import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  calculateMastery,
  type MasteryLevel,
} from './mastery';
import { DEFAULT_SKILL_ID, receptionMathsBank } from './content-bank';

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

type EndedReason = 'completed' | 'exhausted';

type SessionStatus = 'active' | EndedReason;

type SessionRow = {
  child_id: string;
  skill_id: string;
  current_question_id: string | null;
  ended_at: string | null;
};

/** Why a child cannot start practising right now. Neither is an error. */
export type UnavailableReason = 'no_questions_available' | 'daily_limit_reached';

export type StartSessionResult = {
  status: 'active' | 'unavailable';
  reason: UnavailableReason | null;
  /** Child-facing wording. Never a system message. */
  message: string | null;
  /** ISO timestamp the child may start again, when that is knowable. */
  nextAvailableAt: string | null;
  sessionId: string | null;
  childId: string;
  skillId: string;
  question: PublicQuestion | null;
  mastery: Mastery;
  resumed: boolean;
};

export const DEFAULT_DAILY_SESSION_LIMIT = 1;

/** SQLite's own CURRENT_TIMESTAMP format, so stored values stay comparable. */
export function sqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export type TutoringServiceOptions = {
  /** Injectable clock. Retention and the daily cap are date arithmetic. */
  now?: () => Date;
};

export class TutoringService {
  private readonly now: () => Date;

  constructor(
    private readonly database: Database.Database,
    options: TutoringServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Loads the reviewed bank. Re-running it refreshes wording, difficulty,
   * ordering and provenance, but deliberately never touches `reviewed` or
   * `enabled` on a template that already exists — an adult who disabled a
   * question must not have it silently switched back on by a restart.
   */
  seedInitialContent(): void {
    const insertSkill = this.database.prepare(
      `INSERT INTO skills (id, title, curriculum_version, enabled)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         curriculum_version = excluded.curriculum_version`,
    );

    const insertTemplate = this.database.prepare(
      `INSERT INTO content_templates
         (id, skill_id, version, prompt, correct_answer, difficulty,
          sequence, source, licence, reviewed, enabled)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 1, 1)
       ON CONFLICT (id) DO UPDATE SET
         prompt = excluded.prompt,
         correct_answer = excluded.correct_answer,
         difficulty = excluded.difficulty,
         sequence = excluded.sequence,
         source = excluded.source,
         licence = excluded.licence`,
    );

    const seed = this.database.transaction(() => {
      for (const skill of receptionMathsBank) {
        insertSkill.run(skill.id, skill.title, skill.curriculumVersion);
        for (const template of skill.templates) {
          insertTemplate.run(
            template.id,
            skill.id,
            template.prompt,
            template.correctAnswer,
            template.difficulty,
            template.sequence,
            skill.source,
            skill.licence,
          );
        }
      }
    });

    seed();
  }

  /**
   * Resumes the child's active session when one exists so that a restart, a
   * refreshed browser tab or a second device cannot strand progress or leave
   * two open sessions competing for the same mastery evidence.
   *
   * Two outcomes are deliberately *not* errors: the daily cap being reached,
   * and there being nothing selectable to ask. Both are ordinary states for a
   * child who practised earlier — the caller gets `status: 'unavailable'` and
   * child-facing wording rather than a failure the UI has to dress up.
   */
  startSession(input: { childId: string; skillId?: string }): StartSessionResult {
    if (!input.childId.trim()) throw new Error('childId is required');

    const active = this.findActiveSession(input.childId);

    // A resumed session keeps the skill it was started with; the caller cannot
    // switch skill underneath a session that is already running.
    if (active?.current_question_id) {
      return {
        status: 'active',
        reason: null,
        message: null,
        nextAvailableAt: null,
        sessionId: active.id,
        childId: input.childId,
        skillId: active.skill_id,
        question: this.toPublicQuestion(
          this.getReviewedQuestion(active.current_question_id),
        ),
        mastery: this.getMastery(input.childId, active.skill_id),
        resumed: true,
      };
    }

    // An active session with no current question has nothing left to ask.
    // Close it before opening a new one so it cannot linger unreachable.
    if (active) this.endSession(active.id, 'exhausted');

    const skillId = this.requireEnabledSkill(input.skillId ?? DEFAULT_SKILL_ID);
    const currentMastery = this.getMastery(input.childId, skillId);

    // The cap limits new sessions only; resumption above has already returned.
    const cap = this.checkDailySessionLimit(input.childId);
    if (!cap.allowed) {
      return this.unavailable(
        input.childId,
        skillId,
        currentMastery,
        'daily_limit_reached',
        'That is all the practice for today. See you tomorrow!',
        cap.nextAvailableAt,
      );
    }

    const sessionId = randomUUID();
    const question = this.selectNextQuestion(
      sessionId,
      skillId,
      currentMastery.level,
    );
    if (!question) {
      return this.unavailable(
        input.childId,
        skillId,
        currentMastery,
        'no_questions_available',
        'Nothing new to practise right now. Come back a bit later!',
        null,
      );
    }

    const startedAt = sqlTimestamp(this.now());
    const create = this.database.transaction(() => {
      this.database
        .prepare('INSERT OR IGNORE INTO children (id) VALUES (?)')
        .run(input.childId);
      this.database
        .prepare(
          `INSERT INTO sessions
             (id, child_id, skill_id, current_question_id, started_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sessionId, input.childId, skillId, question.id, startedAt);
    });
    create();

    return {
      status: 'active',
      reason: null,
      message: null,
      nextAvailableAt: null,
      sessionId,
      childId: input.childId,
      skillId,
      question: this.toPublicQuestion(question),
      mastery: currentMastery,
      resumed: false,
    };
  }

  private unavailable(
    childId: string,
    skillId: string,
    mastery: Mastery,
    reason: UnavailableReason,
    message: string,
    nextAvailableAt: string | null,
  ): StartSessionResult {
    return {
      status: 'unavailable',
      reason,
      message,
      nextAvailableAt,
      sessionId: null,
      childId,
      skillId,
      question: null,
      mastery,
      resumed: false,
    };
  }

  /**
   * Counts sessions started since midnight *local* time — a family's day ends
   * at their bedtime, not at UTC midnight — against the child's own limit.
   */
  private checkDailySessionLimit(childId: string): {
    allowed: boolean;
    startedToday: number;
    limit: number;
    nextAvailableAt: string;
  } {
    const now = this.now();
    const dayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);

    const limit = this.getDailySessionLimit(childId);
    const { total } = this.database
      .prepare(
        'SELECT COUNT(*) AS total FROM sessions WHERE child_id = ? AND started_at >= ?',
      )
      .get(childId, sqlTimestamp(dayStart)) as { total: number };

    return {
      allowed: total < limit,
      startedToday: total,
      limit,
      nextAvailableAt: nextDay.toISOString(),
    };
  }

  /** The parent-adjustable cap. An unknown child has not practised yet. */
  getDailySessionLimit(childId: string): number {
    const row = this.database
      .prepare('SELECT daily_session_limit FROM children WHERE id = ?')
      .get(childId) as { daily_session_limit: number } | undefined;
    return row?.daily_session_limit ?? DEFAULT_DAILY_SESSION_LIMIT;
  }

  /** Today's usage against the cap, for the parent overview. */
  getDailySessionUsage(childId: string): {
    startedToday: number;
    limit: number;
    nextAvailableAt: string;
  } {
    const { startedToday, limit, nextAvailableAt } =
      this.checkDailySessionLimit(childId);
    return { startedToday, limit, nextAvailableAt };
  }

  /** The skills an adult can start a session on, in curriculum order. */
  listSkills(): Array<{ id: string; title: string; questionCount: number }> {
    return this.database
      .prepare(
        `SELECT s.id, s.title, COUNT(t.id) AS questionCount
         FROM skills s
         LEFT JOIN content_templates t
           ON t.skill_id = s.id AND t.reviewed = 1 AND t.enabled = 1
         WHERE s.enabled = 1
         GROUP BY s.id, s.title
         ORDER BY s.id`,
      )
      .all() as Array<{ id: string; title: string; questionCount: number }>;
  }

  getSession(input: { sessionId: string }): {
    sessionId: string;
    childId: string;
    skillId: string;
    status: SessionStatus;
    question: PublicQuestion | null;
    mastery: Mastery;
  } {
    const session = this.database
      .prepare(
        `SELECT child_id, skill_id, current_question_id, ended_at, ended_reason
         FROM sessions WHERE id = ?`,
      )
      .get(input.sessionId) as
      | (SessionRow & { ended_reason: EndedReason | null })
      | undefined;
    if (!session) throw new Error('Session not found');

    return {
      sessionId: input.sessionId,
      childId: session.child_id,
      skillId: session.skill_id,
      status: session.ended_at ? session.ended_reason ?? 'completed' : 'active',
      question:
        !session.ended_at && session.current_question_id
          ? this.toPublicQuestion(
              this.getReviewedQuestion(session.current_question_id),
            )
          : null,
      mastery: this.getMastery(session.child_id, session.skill_id),
    };
  }

  completeSession(input: { sessionId: string }): {
    sessionId: string;
    endedReason: EndedReason;
    questionsAnswered: number;
    questionsSkipped: number;
    mastery: Mastery;
  } {
    const session = this.database
      .prepare('SELECT child_id, skill_id, ended_at FROM sessions WHERE id = ?')
      .get(input.sessionId) as
      | { child_id: string; skill_id: string; ended_at: string | null }
      | undefined;
    if (!session || session.ended_at) {
      throw new Error('Active session not found');
    }

    return this.database.transaction(() => {
      this.endSession(input.sessionId, 'completed');
      const counts = this.database
        .prepare(
          `SELECT
             SUM(CASE WHEN outcome = 'answered' THEN 1 ELSE 0 END) AS answered,
             SUM(CASE WHEN outcome = 'skipped' THEN 1 ELSE 0 END) AS skipped
           FROM attempts WHERE session_id = ?`,
        )
        .get(input.sessionId) as {
        answered: number | null;
        skipped: number | null;
      };

      return {
        sessionId: input.sessionId,
        endedReason: 'completed' as const,
        questionsAnswered: counts.answered ?? 0,
        questionsSkipped: counts.skipped ?? 0,
        mastery: this.getMastery(session.child_id, session.skill_id),
      };
    })();
  }

  submitAnswer(input: {
    sessionId: string;
    questionId: string;
    answer: string;
  }): {
    correct: boolean;
    mastery: Mastery;
    nextQuestion: PublicQuestion | null;
    status: SessionStatus;
  } {
    const normalizedAnswer = input.answer.trim();
    if (!normalizedAnswer) throw new Error('answer is required');

    const duplicate = this.database
      .prepare(
        'SELECT 1 FROM attempts WHERE session_id = ? AND template_id = ?',
      )
      .get(input.sessionId, input.questionId);
    if (duplicate) throw new Error('This question has already been answered');

    const session = this.getActiveSession(input.sessionId, input.questionId);
    const question = this.getReviewedQuestion(input.questionId);

    const correct = normalizedAnswer === question.correct_answer;

    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO attempts
             (id, session_id, child_id, template_id, template_version, answer,
              is_correct, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.sessionId,
          session.child_id,
          question.id,
          question.version,
          normalizedAnswer,
          correct ? 1 : 0,
          sqlTimestamp(this.now()),
        );

      const mastery = this.recalculateMastery(
        session.child_id,
        question.skill_id,
      );
      const next = this.selectNextQuestion(
        input.sessionId,
        session.skill_id,
        mastery.level,
      );
      this.moveSessionToQuestion(input.sessionId, next);
      const status: SessionStatus = next ? 'active' : 'exhausted';

      return {
        correct,
        mastery,
        nextQuestion: next ? this.toPublicQuestion(next) : null,
        status,
      };
    })();
  }

  skipQuestion(input: {
    sessionId: string;
    questionId: string;
  }): {
    mastery: Mastery;
    nextQuestion: PublicQuestion | null;
    status: SessionStatus;
  } {
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
              answer, is_correct, outcome, created_at)
           VALUES (?, ?, ?, ?, ?, '', 0, 'skipped', ?)`,
        )
        .run(
          randomUUID(),
          input.sessionId,
          session.child_id,
          question.id,
          question.version,
          sqlTimestamp(this.now()),
        );

      const mastery = this.getMastery(session.child_id, question.skill_id);
      const next = this.selectNextQuestion(
        input.sessionId,
        session.skill_id,
        mastery.level,
      );
      this.moveSessionToQuestion(input.sessionId, next);
      const status: SessionStatus = next ? 'active' : 'exhausted';
      return {
        mastery,
        nextQuestion: next ? this.toPublicQuestion(next) : null,
        status,
      };
    })();
  }

  /**
   * Nearest difficulty to the child's level, within the session's own skill and
   * never repeating a question already seen in this session. Ties break on the
   * bank's teaching order, then on ID, so selection is reproducible.
   */
  private selectNextQuestion(
    sessionId: string,
    skillId: string,
    level: MasteryLevel,
  ): QuestionRow | undefined {
    const targetDifficulty = { new: 1, learning: 2, secure: 3 }[level];
    return this.database
      .prepare(
        `SELECT t.id, t.skill_id, t.version, t.prompt, t.correct_answer,
                t.difficulty
         FROM content_templates t
         JOIN skills s ON s.id = t.skill_id
         WHERE t.skill_id = ?
           AND t.reviewed = 1
           AND t.enabled = 1
           AND s.enabled = 1
           AND NOT EXISTS (
             SELECT 1 FROM attempts a
             WHERE a.session_id = ? AND a.template_id = t.id
           )
         ORDER BY ABS(t.difficulty - ?), t.sequence, t.id
         LIMIT 1`,
      )
      .get(skillId, sessionId, targetDifficulty) as QuestionRow | undefined;
  }

  private requireEnabledSkill(skillId: string): string {
    const skill = this.database
      .prepare('SELECT id FROM skills WHERE id = ? AND enabled = 1')
      .get(skillId) as { id: string } | undefined;
    if (!skill) throw new Error('Skill not found');
    return skill.id;
  }

  private findActiveSession(childId: string):
    | { id: string; skill_id: string; current_question_id: string | null }
    | undefined {
    return this.database
      .prepare(
        `SELECT id, skill_id, current_question_id
         FROM sessions
         WHERE child_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(childId) as
      | { id: string; skill_id: string; current_question_id: string | null }
      | undefined;
  }

  private getActiveSession(
    sessionId: string,
    questionId: string,
  ): { child_id: string; skill_id: string } {
    const session = this.database
      .prepare(
        `SELECT child_id, skill_id, current_question_id, ended_at
         FROM sessions WHERE id = ?`,
      )
      .get(sessionId) as SessionRow | undefined;
    if (!session || session.ended_at) throw new Error('Active session not found');
    if (session.current_question_id !== questionId) {
      throw new Error('Question is not active for this session');
    }
    return { child_id: session.child_id, skill_id: session.skill_id };
  }

  private endSession(sessionId: string, reason: EndedReason): void {
    this.database
      .prepare(
        `UPDATE sessions
         SET ended_at = ?, ended_reason = ?
         WHERE id = ? AND ended_at IS NULL`,
      )
      .run(sqlTimestamp(this.now()), reason, sessionId);
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

  /**
   * Mastery is a pure fold over the graded attempts that are currently stored,
   * replayed from `new` rather than from the stored level. That costs nothing
   * at this scale and buys the property the parent-correction slice needs: the
   * level depends only on the evidence, so reversing a correction restores the
   * previous mastery exactly, and pruning old evidence under retention cannot
   * leave the stored level disagreeing with what remains.
   *
   * `corrected_is_correct` is the adult's judgement where one exists; the
   * child's original `is_correct` is never overwritten.
   */
  recalculateMastery(childId: string, skillId: string): Mastery {
    const results = this.database
      .prepare(
        `SELECT COALESCE(a.corrected_is_correct, a.is_correct) AS is_correct
         FROM attempts a
         JOIN content_templates t ON t.id = a.template_id
         WHERE a.child_id = ? AND t.skill_id = ? AND a.outcome = 'answered'
         ORDER BY a.created_at, a.rowid`,
      )
      .all(childId, skillId) as Array<{ is_correct: number }>;
    const graded = results.map((result) => result.is_correct === 1);

    let previousLevel: MasteryLevel = 'new';
    let calculated = calculateMastery([], previousLevel);
    for (let index = 1; index <= graded.length; index += 1) {
      calculated = calculateMastery(graded.slice(0, index), previousLevel);
      previousLevel = calculated.level;
    }

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
      .prepare('UPDATE sessions SET current_question_id = ? WHERE id = ?')
      .run(next?.id ?? null, sessionId);
    if (!next) this.endSession(sessionId, 'exhausted');
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
