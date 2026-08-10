import express, { type NextFunction, type Request, type Response } from 'express';
import type { TutoringService } from './tutoring-service';

export function createApp(tutor: TutoringService): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/api/sessions', (request, response, next) => {
    try {
      if (typeof request.body?.childId !== 'string') {
        throw new Error('childId is required');
      }
      response.status(201).json(
        tutor.startSession({
          childId: request.body.childId,
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
