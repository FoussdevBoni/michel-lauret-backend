import type { RequestHandler } from 'express';
import { niveauClasseService } from '../services/niveauClasseService';
import { HttpError } from '../utils/HttpError';

export const listNiveauxClasses: RequestHandler = async (req, res, next) => {
  try {
    const { cycleId } = req.query;

    if (cycleId !== undefined && typeof cycleId !== 'string') {
      throw new HttpError(400, 'Le filtre de cycle est invalide.');
    }

    res.json(await niveauClasseService.list(cycleId));
  } catch (error) {
    next(error);
  }
};

export const createNiveauClasse: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await niveauClasseService.create(req.body));
  } catch (error) {
    next(error);
  }
};

export const updateNiveauClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const deleteNiveauClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const deleteManyNiveauxClasses: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const getNiveauClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const createManyNiveauxClasses: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const getNiveauxClassesByParent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauClasseService.getByParent(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
