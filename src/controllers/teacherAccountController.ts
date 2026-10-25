import type { RequestHandler } from 'express';
import { teacherAccountService } from '../services/teacherAccountService';
export const getTeacherAccount: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await teacherAccountService.get(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const createTeacherAccount: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await teacherAccountService.create(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const updateTeacherAccount: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherAccountService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
