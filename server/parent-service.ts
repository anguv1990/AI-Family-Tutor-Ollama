import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config';
import { sqlTimestamp, type TutoringService } from './tutoring-service';

/**
 * Everything an adult can do to the stored data: review it, correct it, export
 * it, set retention, and delete it permanently.
 *
 * Two rules run through the whole file:
 *
 * 1. A correction never overwrites what the child actually did. `is_correct`
 *    stays as recorded and `attempt_corrections` is append-only, so the audit
 *    trail survives both the correction and its reversal.
 * 2. Every destructive statement names its rows explicitly and is scoped to one
 *    child. Nothing here leans on `ON DELETE CASCADE`, because migration 005 in
 *    this project already showed a table rebuild silently cascading attempts
 *    away, and deletion is the one operation with no undo.
 */

export const RETENTION_KEYS = {
  sessionDays: 'session_retention_days',
  eventDays: 'event_retention_days',
  lastRunAt: 'retention_last_run_at',
} as const;

/** 0 means "keep until the parent deletes it", which is the default. */
export const DEFAULT_RETENTION = { sessionDays: 0, eventDays: 0 };

export const EXPORT_FORMAT = 'ai-family-tutor.child-export';
export const EXPORT_FORMAT_VERSION = 1;

export const MAXIMUM_DAILY_SESSION_LIMIT = 10;
const MAXIMUM_REASON_LENGTH = 500;
const OVERVIEW_ATTEMPT_LIMIT = 100;

type ChildRow = { id: string; created_at: string; daily_session_limit: number };

type AttemptRow = {
  id: string;
  session_id: string;
  child_id: string;
  template_id: string;
  template_version: number;
  skill_id: string;
  prompt: string;
  answer: string;
  is_correct: number;
  corrected_is_correct: number | null;
  outcome: string;
  created_at: string;
};

export type ParentAttempt = {
  attemptId: string;
  sessionId: string;
  skillId: string;
  templateId: string;
  templateVersion: number;
  prompt: string;
  answer: string;
  outcome: string;
  recordedCorrect: boolean;
  effectiveCorrect: boolean;
  corrected: boolean;
  createdAt: string;
};

export type ParentServiceOptions = {
  now?: () => Date;
};

export class ParentService {
  private readonly now: () => Date;

  constructor(
    private readonly database: Database.Database,
    private readonly tutor: TutoringService,
    private readonly config: AppConfig,
    options: ParentServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------- children

  listChildren(): Array<{
    childId: string;
    createdAt: string;
    dailySessionLimit: number;
    sessionsToday: number;
    sessionCount: number;
    lastSessionAt: string | null;
  }> {
    const rows = this.database
      .prepare(
        `SELECT c.id, c.created_at, c.daily_session_limit,
                COUNT(s.id) AS session_count,
                MAX(s.started_at) AS last_session_at
         FROM children c
         LEFT JOIN sessions s ON s.child_id = c.id
         GROUP BY c.id, c.created_at, c.daily_session_limit
         ORDER BY c.id`,
      )
      .all() as Array<
      ChildRow & { session_count: number; last_session_at: string | null }
    >;

    return rows.map((row) => ({
      childId: row.id,
      createdAt: row.created_at,
      dailySessionLimit: row.daily_session_limit,
      sessionsToday: this.tutor.getDailySessionUsage(row.id).startedToday,
      sessionCount: row.session_count,
      lastSessionAt: row.last_session_at,
    }));
  }

  getSettings(childId: string): {
    childId: string;
    dailySessionLimit: number;
    sessionsToday: number;
    nextAvailableAt: string;
  } {
    const child = this.requireChild(childId);
    const usage = this.tutor.getDailySessionUsage(childId);
    return {
      childId: child.id,
      dailySessionLimit: child.daily_session_limit,
      sessionsToday: usage.startedToday,
      nextAvailableAt: usage.nextAvailableAt,
    };
  }

  /**
   * The daily cap is a wellbeing control, so the parent can raise it but not
   * without limit — an unbounded value would quietly remove the control.
   */
  updateSettings(
    childId: string,
    input: { dailySessionLimit: number },
  ): ReturnType<ParentService['getSettings']> {
    this.requireChild(childId);
    const limit = input.dailySessionLimit;
    if (
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > MAXIMUM_DAILY_SESSION_LIMIT
    ) {
      throw new Error(
        `dailySessionLimit must be a whole number between 0 and ${MAXIMUM_DAILY_SESSION_LIMIT}`,
      );
    }

    this.database
      .prepare('UPDATE children SET daily_session_limit = ? WHERE id = ?')
      .run(limit, childId);
    return this.getSettings(childId);
  }

  // ------------------------------------------------------------- corrections

  correctAttempt(
    attemptId: string,
    input: { isCorrect: boolean; reason: string },
  ): {
    attemptId: string;
    childId: string;
    skillId: string;
    originalIsCorrect: boolean;
    correctedIsCorrect: boolean;
    reason: string;
    mastery: ReturnType<TutoringService['recalculateMastery']>;
  } {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.outcome !== 'answered') {
      // A skip is not graded evidence, so there is no evaluation to correct.
      throw new Error('Only an answered attempt can be corrected');
    }
    if (typeof input.isCorrect !== 'boolean') {
      throw new Error('isCorrect must be true or false');
    }
    const reason = input.reason?.trim() ?? '';
    if (!reason) throw new Error('reason is required');
    if (reason.length > MAXIMUM_REASON_LENGTH) {
      throw new Error(`reason must be ${MAXIMUM_REASON_LENGTH} characters or fewer`);
    }

    const corrected = input.isCorrect ? 1 : 0;
    return this.database.transaction(() => {
      this.database
        .prepare('UPDATE attempts SET corrected_is_correct = ? WHERE id = ?')
        .run(corrected, attemptId);
      this.recordCorrection(attempt, 'applied', corrected, reason);

      return {
        attemptId,
        childId: attempt.child_id,
        skillId: attempt.skill_id,
        originalIsCorrect: attempt.is_correct === 1,
        correctedIsCorrect: input.isCorrect,
        reason,
        mastery: this.tutor.recalculateMastery(
          attempt.child_id,
          attempt.skill_id,
        ),
      };
    })();
  }

  /**
   * Withdraws the adult's judgement and lets the child's own result stand
   * again. Because mastery is replayed from the stored evidence, this restores
   * exactly the state that existed before the correction.
   */
  reverseCorrection(attemptId: string): {
    attemptId: string;
    childId: string;
    skillId: string;
    restoredIsCorrect: boolean;
    mastery: ReturnType<TutoringService['recalculateMastery']>;
  } {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.corrected_is_correct === null) {
      throw new Error('This attempt has no correction to reverse');
    }

    return this.database.transaction(() => {
      this.database
        .prepare('UPDATE attempts SET corrected_is_correct = NULL WHERE id = ?')
        .run(attemptId);
      this.recordCorrection(
        attempt,
        'reversed',
        null,
        'Correction withdrawn by an adult',
      );

      return {
        attemptId,
        childId: attempt.child_id,
        skillId: attempt.skill_id,
        restoredIsCorrect: attempt.is_correct === 1,
        mastery: this.tutor.recalculateMastery(
          attempt.child_id,
          attempt.skill_id,
        ),
      };
    })();
  }

  /**
   * `corrected_is_correct` on an audit row is the value in force *after* the
   * action, so a reversal records NULL. `original_is_correct` is always what
   * the child's answer scored and is never rewritten.
   */
  private recordCorrection(
    attempt: AttemptRow,
    action: 'applied' | 'reversed',
    correctedIsCorrect: number | null,
    reason: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO attempt_corrections
           (id, attempt_id, child_id, action, original_is_correct,
            corrected_is_correct, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        attempt.id,
        attempt.child_id,
        action,
        attempt.is_correct,
        correctedIsCorrect,
        reason,
        sqlTimestamp(this.now()),
      );
  }

  // ---------------------------------------------------------------- overview

  getOverview(childId: string): Record<string, unknown> {
    const child = this.requireChild(childId);
    const usage = this.tutor.getDailySessionUsage(childId);

    const sessions = this.readSessions(childId);
    const attempts = this.readAttempts(childId, OVERVIEW_ATTEMPT_LIMIT);
    const sessionNumbers = new Map(
      sessions.map((session) => [session.sessionId, session.number]),
    );

    const totals = this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN outcome = 'answered' THEN 1 ELSE 0 END) AS answered,
           SUM(CASE WHEN outcome = 'skipped' THEN 1 ELSE 0 END) AS skipped,
           SUM(CASE WHEN outcome = 'answered'
                     AND COALESCE(corrected_is_correct, is_correct) = 1
                    THEN 1 ELSE 0 END) AS correct
         FROM attempts WHERE child_id = ?`,
      )
      .get(childId) as {
      answered: number | null;
      skipped: number | null;
      correct: number | null;
    };

    return {
      childId: child.id,
      createdAt: child.created_at,
      settings: {
        dailySessionLimit: child.daily_session_limit,
        sessionsToday: usage.startedToday,
        nextAvailableAt: usage.nextAvailableAt,
      },
      mastery: this.readMastery(childId),
      sessions: [...sessions].reverse(),
      attempts: attempts.map((attempt) => ({
        ...attempt,
        sessionNumber: sessionNumbers.get(attempt.sessionId) ?? null,
      })),
      corrections: this.readCorrections(childId),
      events: this.readSafetyEvents(childId, sessionNumbers),
      totals: {
        sessions: sessions.length,
        answered: totals.answered ?? 0,
        skipped: totals.skipped ?? 0,
        correct: totals.correct ?? 0,
      },
    };
  }

  // ------------------------------------------------------------------ export

  /**
   * A complete copy of one child's stored learning data, and nothing else.
   * Deliberately excluded: the model cache (shared, keyed by prompt hash, holds
   * no child data), the admin secret and any other configuration value, and the
   * answer keys — those belong to the reviewed content bank, not to the child.
   */
  exportChild(childId: string): Record<string, unknown> {
    const child = this.requireChild(childId);
    const sessions = this.readSessions(childId);

    return {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: this.now().toISOString(),
      schemaVersion: this.currentSchemaVersion(),
      excluded: [
        'model cache entries',
        'answer keys',
        'configuration values and the admin secret',
        'audio (none is ever recorded)',
      ],
      child: {
        childId: child.id,
        createdAt: child.created_at,
        dailySessionLimit: child.daily_session_limit,
      },
      mastery: this.readMastery(childId),
      sessions: [...sessions].reverse(),
      attempts: this.readAttempts(childId),
      corrections: this.readCorrections(childId),
      safetyEvents: this.readSafetyEvents(
        childId,
        new Map(sessions.map((session) => [session.sessionId, session.number])),
      ),
    };
  }

  // ---------------------------------------------------------------- deletion

  /**
   * Permanent, confirmed deletion of one child.
   *
   * Removed: the child row, sessions, attempts, correction audit rows, mastery
   * and the safety events raised during that child's sessions.
   *
   * Kept, deliberately: skills and content templates (shared reviewed
   * curriculum, not the child's data), model cache entries (shared and keyed by
   * prompt hash, containing no child data), schema versions and parent
   * settings. Another child's records are never touched — the isolation test
   * proves it.
   */
  deleteChild(
    childId: string,
    confirm: string,
  ): {
    childId: string;
    deleted: {
      sessions: number;
      attempts: number;
      corrections: number;
      mastery: number;
      safetyEvents: number;
      child: number;
    };
  } {
    this.requireChild(childId);
    if (confirm !== childId) {
      throw new Error('confirm must repeat the child id exactly');
    }

    return this.database.transaction(() => {
      const safetyEvents = this.database
        .prepare(
          `DELETE FROM safety_events
           WHERE session_id IN (SELECT id FROM sessions WHERE child_id = ?)`,
        )
        .run(childId).changes;
      const corrections = this.database
        .prepare('DELETE FROM attempt_corrections WHERE child_id = ?')
        .run(childId).changes;
      const attempts = this.database
        .prepare('DELETE FROM attempts WHERE child_id = ?')
        .run(childId).changes;
      // Clearing the pointer first keeps the delete independent of the order
      // SQLite happens to check the content_templates foreign key in.
      this.database
        .prepare(
          'UPDATE sessions SET current_question_id = NULL WHERE child_id = ?',
        )
        .run(childId);
      const sessions = this.database
        .prepare('DELETE FROM sessions WHERE child_id = ?')
        .run(childId).changes;
      const mastery = this.database
        .prepare('DELETE FROM mastery WHERE child_id = ?')
        .run(childId).changes;
      const child = this.database
        .prepare('DELETE FROM children WHERE id = ?')
        .run(childId).changes;

      return {
        childId,
        deleted: {
          sessions,
          attempts,
          corrections,
          mastery,
          safetyEvents,
          child,
        },
      };
    })();
  }

  // --------------------------------------------------------------- retention

  getRetention(): {
    sessionDays: number;
    eventDays: number;
    lastRunAt: string | null;
  } {
    return {
      sessionDays: this.readNumberSetting(
        RETENTION_KEYS.sessionDays,
        DEFAULT_RETENTION.sessionDays,
      ),
      eventDays: this.readNumberSetting(
        RETENTION_KEYS.eventDays,
        DEFAULT_RETENTION.eventDays,
      ),
      lastRunAt: this.readSetting(RETENTION_KEYS.lastRunAt),
    };
  }

  updateRetention(input: {
    sessionDays: number;
    eventDays: number;
  }): ReturnType<ParentService['getRetention']> {
    for (const value of [input.sessionDays, input.eventDays]) {
      if (!Number.isInteger(value) || value < 0 || value > 3650) {
        throw new Error('Retention days must be a whole number between 0 and 3650');
      }
    }

    const write = this.database.transaction(() => {
      this.writeSetting(RETENTION_KEYS.sessionDays, String(input.sessionDays));
      this.writeSetting(RETENTION_KEYS.eventDays, String(input.eventDays));
    });
    write();
    return this.getRetention();
  }

  /**
   * Deletes only expired, in-scope records: sessions that have *ended* and are
   * older than the session retention period, together with everything derived
   * from them, plus safety events older than the event retention period. A
   * period of 0 means "keep indefinitely" and removes nothing, so retention is
   * never destructive until a parent asks for it.
   *
   * Mastery rows are kept, but recalculated afterwards for every affected
   * child and skill: mastery is a fold over the stored evidence, so pruning
   * evidence must not leave a level that the remaining attempts do not support.
   */
  runRetention(): {
    sessionDays: number;
    eventDays: number;
    removed: {
      sessions: number;
      attempts: number;
      corrections: number;
      safetyEvents: number;
    };
    ranAt: string;
  } {
    const { sessionDays, eventDays } = this.getRetention();
    const now = this.now();

    return this.database.transaction(() => {
      const removed = {
        sessions: 0,
        attempts: 0,
        corrections: 0,
        safetyEvents: 0,
      };

      if (sessionDays > 0) {
        const cutoff = sqlTimestamp(this.daysBefore(now, sessionDays));
        const expired = this.database
          .prepare(
            `SELECT id FROM sessions
             WHERE ended_at IS NOT NULL AND ended_at < ?`,
          )
          .all(cutoff) as Array<{ id: string }>;

        if (expired.length > 0) {
          const affected = this.database
            .prepare(
              `SELECT DISTINCT a.child_id AS childId, t.skill_id AS skillId
               FROM attempts a
               JOIN content_templates t ON t.id = a.template_id
               WHERE a.session_id IN (${expired.map(() => '?').join(',')})`,
            )
            .all(...expired.map((session) => session.id)) as Array<{
            childId: string;
            skillId: string;
          }>;

          for (const session of expired) {
            removed.safetyEvents += this.database
              .prepare('DELETE FROM safety_events WHERE session_id = ?')
              .run(session.id).changes;
            removed.corrections += this.database
              .prepare(
                `DELETE FROM attempt_corrections
                 WHERE attempt_id IN (SELECT id FROM attempts WHERE session_id = ?)`,
              )
              .run(session.id).changes;
            removed.attempts += this.database
              .prepare('DELETE FROM attempts WHERE session_id = ?')
              .run(session.id).changes;
            this.database
              .prepare(
                'UPDATE sessions SET current_question_id = NULL WHERE id = ?',
              )
              .run(session.id);
            removed.sessions += this.database
              .prepare('DELETE FROM sessions WHERE id = ?')
              .run(session.id).changes;
          }

          for (const pair of affected) {
            this.tutor.recalculateMastery(pair.childId, pair.skillId);
          }
        }
      }

      if (eventDays > 0) {
        const cutoff = sqlTimestamp(this.daysBefore(now, eventDays));
        removed.safetyEvents += this.database
          .prepare('DELETE FROM safety_events WHERE created_at < ?')
          .run(cutoff).changes;
      }

      const ranAt = now.toISOString();
      this.writeSetting(RETENTION_KEYS.lastRunAt, ranAt);
      return { sessionDays, eventDays, removed, ranAt };
    })();
  }

  /** The cache holds generated wording, never child data, so this is safe. */
  clearCache(): { cleared: number } {
    return {
      cleared: this.database.prepare('DELETE FROM cache').run().changes,
    };
  }

  // ------------------------------------------------------------------ privacy

  getPrivacySummary(): Record<string, unknown> {
    const counts = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM children) AS children,
           (SELECT COUNT(*) FROM sessions) AS sessions,
           (SELECT COUNT(*) FROM attempts) AS attempts,
           (SELECT COUNT(*) FROM attempt_corrections) AS corrections,
           (SELECT COUNT(*) FROM safety_events) AS safetyEvents,
           (SELECT COUNT(*) FROM cache) AS cacheEntries`,
      )
      .get() as Record<string, number>;

    return {
      storage: {
        databasePath: this.config.databasePath,
        location: 'This device only. Nothing is sent to any server.',
      },
      network: {
        host: this.config.host,
        port: this.config.port,
        lanMode: this.config.lanMode,
        assumption: this.config.lanMode
          ? 'LAN mode trusts every device on this home network to be well ' +
            'intentioned. The admin secret is the only barrier.'
          : 'Loopback only: nothing outside this machine can reach the app.',
      },
      parentAccess:
        this.config.parentAccess === 'admin-secret'
          ? {
              mode: 'admin-secret',
              detail: 'Parent pages require the admin secret.',
            }
          : {
              mode: 'open-loopback',
              detail:
                'ADMIN_SECRET is not set, so anyone using this machine can ' +
                'open the parent pages. Set ADMIN_SECRET to require it.',
            },
      stored: [
        'Which reviewed question was asked, and the answer the child chose',
        'Session start/end times and mastery level per skill',
        'Adult corrections and the reason given',
        'Safety and fallback events',
      ],
      notStored: [
        'Audio: no recording is made or kept, in any mode',
        'Names, birthdays, school details or any other identifier — the child ' +
          'id is whatever label the adult typed',
        'Free text from the child beyond the selected answer',
        'Any cloud copy or analytics',
      ],
      retention: this.getRetention(),
      counts,
    };
  }

  // ------------------------------------------------------------------ reading

  private readMastery(childId: string): Array<Record<string, unknown>> {
    return (
      this.database
        .prepare(
          `SELECT m.skill_id, s.title, m.level, m.correct_attempts,
                  m.total_attempts, m.score, m.updated_at
           FROM mastery m
           LEFT JOIN skills s ON s.id = m.skill_id
           WHERE m.child_id = ?
           ORDER BY m.skill_id`,
        )
        .all(childId) as Array<{
        skill_id: string;
        title: string | null;
        level: string;
        correct_attempts: number;
        total_attempts: number;
        score: number;
        updated_at: string;
      }>
    ).map((row) => ({
      skillId: row.skill_id,
      skillTitle: row.title,
      level: row.level,
      correctAttempts: row.correct_attempts,
      totalAttempts: row.total_attempts,
      score: row.score,
      updatedAt: row.updated_at,
    }));
  }

  /** Oldest first, so the session number is stable as new sessions arrive. */
  private readSessions(childId: string): Array<{
    sessionId: string;
    number: number;
    label: string;
    skillId: string;
    skillTitle: string | null;
    startedAt: string;
    endedAt: string | null;
    status: string;
    answered: number;
    skipped: number;
    correct: number;
  }> {
    const rows = this.database
      .prepare(
        `SELECT s.id, s.skill_id, k.title, s.started_at, s.ended_at,
                s.ended_reason,
                SUM(CASE WHEN a.outcome = 'answered' THEN 1 ELSE 0 END) AS answered,
                SUM(CASE WHEN a.outcome = 'skipped' THEN 1 ELSE 0 END) AS skipped,
                SUM(CASE WHEN a.outcome = 'answered'
                          AND COALESCE(a.corrected_is_correct, a.is_correct) = 1
                         THEN 1 ELSE 0 END) AS correct
         FROM sessions s
         LEFT JOIN skills k ON k.id = s.skill_id
         LEFT JOIN attempts a ON a.session_id = s.id
         WHERE s.child_id = ?
         GROUP BY s.id
         ORDER BY s.started_at, s.rowid`,
      )
      .all(childId) as Array<{
      id: string;
      skill_id: string;
      title: string | null;
      started_at: string;
      ended_at: string | null;
      ended_reason: string | null;
      answered: number | null;
      skipped: number | null;
      correct: number | null;
    }>;

    return rows.map((row, index) => ({
      sessionId: row.id,
      number: index + 1,
      // A number and a date, never a name: the parent view identifies a
      // session by when it happened, not by anything about the child.
      label: `Session ${index + 1}`,
      skillId: row.skill_id,
      skillTitle: row.title,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.ended_at ? row.ended_reason ?? 'completed' : 'active',
      answered: row.answered ?? 0,
      skipped: row.skipped ?? 0,
      correct: row.correct ?? 0,
    }));
  }

  private readAttempts(childId: string, limit?: number): ParentAttempt[] {
    const rows = this.database
      .prepare(
        `SELECT a.id, a.session_id, a.child_id, a.template_id,
                a.template_version, t.skill_id, t.prompt, a.answer,
                a.is_correct, a.corrected_is_correct, a.outcome, a.created_at
         FROM attempts a
         JOIN content_templates t ON t.id = a.template_id
         WHERE a.child_id = ?
         ORDER BY a.created_at DESC, a.rowid DESC
         ${limit ? 'LIMIT ?' : ''}`,
      )
      .all(...(limit ? [childId, limit] : [childId])) as AttemptRow[];

    return rows.map((row) => ({
      attemptId: row.id,
      sessionId: row.session_id,
      skillId: row.skill_id,
      templateId: row.template_id,
      templateVersion: row.template_version,
      prompt: row.prompt,
      answer: row.answer,
      outcome: row.outcome,
      // What the child scored, and what counts towards mastery now. They differ
      // only where an adult has corrected the evaluation.
      recordedCorrect: row.is_correct === 1,
      effectiveCorrect:
        (row.corrected_is_correct ?? row.is_correct) === 1,
      corrected: row.corrected_is_correct !== null,
      createdAt: row.created_at,
    }));
  }

  private readCorrections(childId: string): Array<Record<string, unknown>> {
    return (
      this.database
        .prepare(
          `SELECT id, attempt_id, action, original_is_correct,
                  corrected_is_correct, reason, created_at
           FROM attempt_corrections
           WHERE child_id = ?
           ORDER BY created_at DESC, rowid DESC`,
        )
        .all(childId) as Array<{
        id: string;
        attempt_id: string;
        action: string;
        original_is_correct: number;
        corrected_is_correct: number | null;
        reason: string;
        created_at: string;
      }>
    ).map((row) => ({
      correctionId: row.id,
      attemptId: row.attempt_id,
      action: row.action,
      originalIsCorrect: row.original_is_correct === 1,
      correctedIsCorrect:
        row.corrected_is_correct === null ? null : row.corrected_is_correct === 1,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  private readSafetyEvents(
    childId: string,
    sessionNumbers: Map<string, number>,
  ): Array<Record<string, unknown>> {
    return (
      this.database
        .prepare(
          `SELECT e.id, e.session_id, e.event_type, e.created_at
           FROM safety_events e
           JOIN sessions s ON s.id = e.session_id
           WHERE s.child_id = ?
           ORDER BY e.created_at DESC, e.rowid DESC`,
        )
        .all(childId) as Array<{
        id: string;
        session_id: string;
        event_type: string;
        created_at: string;
      }>
    ).map((row) => ({
      eventId: row.id,
      sessionId: row.session_id,
      sessionNumber: sessionNumbers.get(row.session_id) ?? null,
      eventType: row.event_type,
      createdAt: row.created_at,
    }));
  }

  // ------------------------------------------------------------------ helpers

  private requireChild(childId: string): ChildRow {
    const child = this.database
      .prepare(
        'SELECT id, created_at, daily_session_limit FROM children WHERE id = ?',
      )
      .get(childId) as ChildRow | undefined;
    if (!child) throw new Error('Child not found');
    return child;
  }

  private requireAttempt(attemptId: string): AttemptRow {
    const attempt = this.database
      .prepare(
        `SELECT a.id, a.session_id, a.child_id, a.template_id,
                a.template_version, t.skill_id, t.prompt, a.answer,
                a.is_correct, a.corrected_is_correct, a.outcome, a.created_at
         FROM attempts a
         JOIN content_templates t ON t.id = a.template_id
         WHERE a.id = ?`,
      )
      .get(attemptId) as AttemptRow | undefined;
    if (!attempt) throw new Error('Attempt not found');
    return attempt;
  }

  private currentSchemaVersion(): number {
    const row = this.database
      .prepare('SELECT MAX(version) AS version FROM schema_versions')
      .get() as { version: number | null };
    return row.version ?? 0;
  }

  private daysBefore(now: Date, days: number): Date {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  private readSetting(key: string): string | null {
    const row = this.database
      .prepare('SELECT value FROM parent_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private readNumberSetting(key: string, fallback: number): number {
    const raw = this.readSetting(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  private writeSetting(key: string, value: string): void {
    this.database
      .prepare(
        `INSERT INTO parent_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, sqlTimestamp(this.now()));
  }
}
