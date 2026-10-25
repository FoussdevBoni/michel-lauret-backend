import type { RequestHandler } from 'express';
import { noteService } from '../services/noteService';
export const listNotes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const getNote: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const getNotesByInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.getByInscription(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getNotesByMatiere: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.getByMatiere(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getNotesByPeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.getByPeriode(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getNotesByClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.getByClasse(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getNotesByEleve: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.getByEleve(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const createNote: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await noteService.create(req.body));
  } catch (error) {
    next(error);
  }
};
export const createBatchNotes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.createBatch(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const updateNote: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const closeNote: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.close(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const closeBatchNotes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.closeBatch(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const importNotes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.importFromExcel(req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteNote: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyNotes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await noteService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};
