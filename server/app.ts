import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import type { TutoringService } from './tutoring-service';

export function createApp(tutor: TutoringService): express.Express {
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
      response.status(201).json(
        tutor.startSession({
          childId: request.body.childId,
          skillId,
        }),
      );
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
