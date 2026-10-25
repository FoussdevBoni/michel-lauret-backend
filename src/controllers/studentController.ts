import type { RequestHandler } from 'express';
import { studentService } from '../services/studentService';

export const listStudents: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await studentService.list());
  } catch (error) {
    next(error);
  }
};

export const createStudent: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await studentService.create(req.body));
  } catch (error) {
    next(error);
  }
};

export const updateStudent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await studentService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const deleteStudent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await studentService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const deleteManyStudents: RequestHandler = async (req, res, next) => {
  try {
    res.json(await studentService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const getStudent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await studentService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const createManyStudents: RequestHandler = async (req, res, next) => {
  try {
    res.json(await studentService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};

export const getStudentByMatricule: RequestHandler = async (req, res, next) => {
  try {
    res.json(await studentService.getByMatricule(req.params.matricule));
  } catch (error) {
    next(error);
  }
};
