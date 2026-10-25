import type { RequestHandler } from 'express';
import { teacherPortalService } from '../services/teacherPortalService';
export const getTeacherLogo: RequestHandler = async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await teacherPortalService.logo(res.locals.user.id));
  } catch (error) {
    next(error);
  }
};

export const getTeacherWorkspace: RequestHandler = async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await teacherPortalService.snapshot(res.locals.user.id));
  } catch (error) {
    next(error);
  }
};
export const synchronizeTeacherNotes: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await teacherPortalService.mutate(res.locals.user.id, req.body));
  } catch (error) {
    next(error);
  }
};
