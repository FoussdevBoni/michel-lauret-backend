import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ZodError } from 'zod';
import { HttpError } from '../utils/HttpError';

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ message: error.issues[0].message });
    return;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  ) {
    const isMatricule =
      'keyPattern' in error &&
      typeof error.keyPattern === 'object' &&
      error.keyPattern !== null &&
      'matricule' in error.keyPattern;
    res.status(409).json({
      message: isMatricule
        ? 'Un élève possède déjà ce matricule.'
        : 'Une donnée portant ce nom existe déjà.',
    });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ message: 'Le contenu JSON de la requête est invalide.' });
    return;
  }

  if (env.NODE_ENV !== 'test') {
    console.error(error);
  }

  res.status(500).json({
    message: 'Une erreur interne est survenue.',
  });
}
