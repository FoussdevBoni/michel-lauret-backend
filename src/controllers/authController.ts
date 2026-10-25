import type { RequestHandler } from 'express';
import { authService } from '../services/authService';
import { offlineAccessService } from '../services/offlineAccessService';
import { accountService } from '../services/accountService';
export const changePassword: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await accountService.changePassword(res.locals.user.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const login: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await authService.login(req.body));
  } catch (error) {
    next(error);
  }
};
export const me: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(res.locals.user);
};

export const enableOfflineAccess: RequestHandler = async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await offlineAccessService.issue(res.locals.user));
  } catch (error) {
    next(error);
  }
};
