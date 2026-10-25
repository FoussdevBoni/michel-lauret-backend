import type { RequestHandler } from 'express';
import { niveauClasseSyncService } from '../services/niveauClasseSyncService';

export const listNiveauClasseSync: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await niveauClasseSyncService.page(req.query));
  } catch (error) {
    next(error);
  }
};

export const mutateNiveauClasseSync: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseSyncService.mutate(req.body, res.locals.user.id));
  } catch (error) {
    next(error);
  }
};
