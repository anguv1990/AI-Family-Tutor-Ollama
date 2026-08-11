import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { loadConfig, type AppConfig } from './config';
import type { ParentService } from './parent-service';
import type { TutoringService } from './tutoring-service';

export type AppOptions = {
  /** Wiring the parent service in enables the /api/parent routes. */
  parent?: ParentService;
  config?: AppConfig;
};

/**
 * Constant-time comparison of the caller's secret against the configured one.
 * Both sides are hashed first so the comparison is over equal-length buffers
 * whatever the caller sends, and `===` never sees the secret.
 */
function secretMatches(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export function createApp(
  tutor: TutoringService,
  options: AppOptions = {},
): express.Express {
  const config = options.config ?? loadConfig();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Resolved from the working directory, matching how migrations are located
  // in database.ts, so the path is the same under ts-node-dev and dist/.
  app.use(express.static(path.resolve(process.cwd(), 'web')));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/skills', (_request, response, next) => {
    try {
      response.json({ skills: tutor.listSkills() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sessions', (request, response, next) => {
    try {
      if (typeof request.body?.childId !== 'string') {
        throw new Error('childId is required');
      }
      const skillId = request.body?.skillId;
      if (skillId !== undefined && typeof skillId !== 'string') {
        throw new Error('skillId must be a string');
      }
      const result = tutor.startSession({
        childId: request.body.childId,
        skillId,
      });
      // "Nothing to practise right now" and "that is enough for today" are
      // ordinary states, not failures, so they answer 200 with a message the
      // UI can show kindly rather than an error it has to translate.
      response.status(result.status === 'active' ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sessions/:sessionId', (request, response, next) => {
    try {
      response.json(tutor.getSession({ sessionId: request.params.sessionId }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sessions/:sessionId/complete', (request, response, next) => {
    try {
      response.json(
        tutor.completeSession({ sessionId: request.params.sessionId }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sessions/:sessionId/answers', (request, response, next) => {
    try {
      if (
        typeof request.body?.questionId !== 'string' ||
        typeof request.body?.answer !== 'string'
      ) {
        throw new Error('questionId and answer are required');
      }
      response.json(
        tutor.submitAnswer({
          sessionId: request.params.sessionId,
          questionId: request.body.questionId,
          answer: request.body.answer,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sessions/:sessionId/skip', (request, response, next) => {
    try {
      if (typeof request.body?.questionId !== 'string') {
        throw new Error('questionId is required');
      }
      response.json(
        tutor.skipQuestion({
          sessionId: request.params.sessionId,
          questionId: request.body.questionId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  if (options.parent) registerParentRoutes(app, options.parent, config);

  app.use(
    (
      _error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      response.status(400).json({ error: 'invalid_request' });
    },
  );

  return app;
}

/**
 * Every parent route is behind one authorisation check that runs before any
 * database read, so an unauthenticated caller cannot learn whether a child id
 * exists by comparing a 400 with a 401.
 */
function registerParentRoutes(
  app: express.Express,
  parent: ParentService,
  config: AppConfig,
): void {
  const requireParentAccess = (
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    if (!config.adminSecret) {
      // No secret configured. Only reachable from this machine, because
      // loadConfig refuses to start a LAN bind without one.
      if (!config.lanMode) return next();
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    const provided = request.get('x-admin-secret');
    if (provided && secretMatches(provided, config.adminSecret)) return next();
    response.status(401).json({ error: 'unauthorized' });
  };

  const requireString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${field} is required`);
    }
    return value;
  };

  const parentRouter = express.Router();
  parentRouter.use(requireParentAccess);

  parentRouter.get('/children', (_request, response, next) => {
    try {
      response.json({ children: parent.listChildren() });
    } catch (error) {
      next(error);
    }
  });

  parentRouter.get('/children/:childId/overview', (request, response, next) => {
    try {
      response.json(parent.getOverview(request.params.childId));
    } catch (error) {
      next(error);
    }
  });

  parentRouter.get('/children/:childId/export', (request, response, next) => {
    try {
      response.json(parent.exportChild(request.params.childId));
    } catch (error) {
      next(error);
    }
  });

  parentRouter.delete('/children/:childId', (request, response, next) => {
    try {
      const confirm = requireString(request.body?.confirm, 'confirm');
      response.json(parent.deleteChild(request.params.childId, confirm));
    } catch (error) {
      next(error);
    }
  });

  parentRouter.get('/children/:childId/settings', (request, response, next) => {
    try {
      response.json(parent.getSettings(request.params.childId));
    } catch (error) {
      next(error);
    }
  });

  parentRouter.put('/children/:childId/settings', (request, response, next) => {
    try {
      response.json(
        parent.updateSettings(request.params.childId, {
          dailySessionLimit: request.body?.dailySessionLimit,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  parentRouter.post(
    '/attempts/:attemptId/correction',
    (request, response, next) => {
      try {
        response.json(
          parent.correctAttempt(request.params.attemptId, {
            isCorrect: request.body?.isCorrect,
            reason: requireString(request.body?.reason, 'reason'),
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  parentRouter.delete(
    '/attempts/:attemptId/correction',
    (request, response, next) => {
      try {
        response.json(parent.reverseCorrection(request.params.attemptId));
      } catch (error) {
        next(error);
      }
    },
  );

  parentRouter.get('/privacy', (_request, response, next) => {
    try {
      response.json(parent.getPrivacySummary());
    } catch (error) {
      next(error);
    }
  });

  parentRouter.put('/retention', (request, response, next) => {
    try {
      response.json(
        parent.updateRetention({
          sessionDays: request.body?.sessionDays,
          eventDays: request.body?.eventDays,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  parentRouter.post('/retention/run', (_request, response, next) => {
    try {
      response.json(parent.runRetention());
    } catch (error) {
      next(error);
    }
  });

  parentRouter.post('/cache/clear', (_request, response, next) => {
    try {
      response.json(parent.clearCache());
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/parent', parentRouter);
}
