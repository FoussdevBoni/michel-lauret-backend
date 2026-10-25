import type { RequestHandler } from 'express';
import { classeService } from '../services/classeService';
import { HttpError } from '../utils/HttpError';

export const listClasses: RequestHandler = async (req, res, next) => {
  try {
    const { niveauClasseId } = req.query;

    if (niveauClasseId !== undefined && typeof niveauClasseId !== 'string') {
      throw new HttpError(400, 'Le filtre de niveau de classe est invalide.');
    }

    res.json(await classeService.list(niveauClasseId));
  } catch (error) {
    next(error);
  }
};

export const createClasse: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await classeService.create(req.body));
  } catch (error) {
    next(error);
  }
};

export const updateClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await classeService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const deleteClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await classeService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const deleteManyClasses: RequestHandler = async (req, res, next) => {
  try {
    res.json(await classeService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const getClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await classeService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const createManyClasses: RequestHandler = async (req, res, next) => {
  try {
    res.json(await classeService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const getClassesByParent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await classeService.getByParent(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
