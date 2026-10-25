import type { RequestHandler } from 'express';
import { cycleSyncService } from '../services/cycleSyncService';

export const listCycleSync: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await cycleSyncService.page(req.query));
  } catch (error) {
    next(error);
  }
};

export const mutateCycleSync: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleSyncService.mutate(req.body, res.locals.user.id));
  } catch (error) {
    next(error);
  }
};
