import type { RequestHandler } from 'express';
import { requireActiveAdministrator } from '../services/accessService';

export const administratorMiddleware: RequestHandler = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentification requise.' });
    return;
  }

  requireActiveAdministrator(authorization.slice(7))
    .then((user) => {
      res.locals.user = user;
      next();
    })
    .catch(next);
};
