import type { RequestHandler } from 'express';
import { cycleService } from '../services/cycleService';
import { HttpError } from '../utils/HttpError';

export const listCycles: RequestHandler = async (req, res, next) => {
  try {
    const { niveauScolaireId } = req.query;

    if (niveauScolaireId !== undefined && typeof niveauScolaireId !== 'string') {
      throw new HttpError(400, 'Le filtre de niveau scolaire est invalide.');
    }

    res.json(await cycleService.list(niveauScolaireId));
  } catch (error) {
    next(error);
  }
};

export const createCycle: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await cycleService.create(req.body));
  } catch (error) {
    next(error);
  }
};

export const updateCycle: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const deleteCycle: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const deleteManyCycles: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const getCycle: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const createManyCycles: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const getCyclesByParent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await cycleService.getByParent(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
