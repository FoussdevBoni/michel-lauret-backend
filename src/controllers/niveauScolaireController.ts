import type { RequestHandler } from 'express';
import { niveauScolaireService } from '../services/niveauScolaireService';

export const listNiveauxScolaires: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await niveauScolaireService.list());
  } catch (error) {
    next(error);
  }
};

export const createNiveauScolaire: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await niveauScolaireService.create(req.body));
  } catch (error) {
    next(error);
  }
};

export const updateNiveauScolaire: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauScolaireService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const deleteNiveauScolaire: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauScolaireService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const deleteManyNiveauxScolaires: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauScolaireService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const getNiveauScolaire: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauScolaireService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const createManyNiveauxScolaires: RequestHandler = async (req, res, next) => {
  try {
    res.json(await niveauScolaireService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
