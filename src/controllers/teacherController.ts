import type { RequestHandler } from 'express';
import { teacherService } from '../services/teacherService';
export const listTeachers: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const getTeacher: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const getTeachersByClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.getByClasse(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getTeachersByMatiere: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.getByMatiere(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const searchTeachers: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.search(req.body?.recherche));
  } catch (error) {
    next(error);
  }
};
export const createTeacher: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await teacherService.create(req.body));
  } catch (error) {
    next(error);
  }
};
export const createManyTeachers: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const updateTeacher: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteTeacher: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyTeachers: RequestHandler = async (req, res, next) => {
  try {
    res.json(await teacherService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};
