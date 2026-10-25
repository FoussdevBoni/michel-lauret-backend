import type { RequestHandler } from 'express';
import { niveauScolaireSyncService } from '../services/niveauScolaireSyncService';

export const listNiveauSync: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await niveauScolaireSyncService.page(req.query));
  } catch (error) {
    next(error);
  }
};

export const mutateNiveauSync: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauScolaireSyncService.mutate(req.body, res.locals.user.id));
  } catch (error) {
    next(error);
  }
};
