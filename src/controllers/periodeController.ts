import type { RequestHandler } from 'express';
import { periodeService } from '../services/periodeService';
export const listPeriodes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const getPeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const getPeriodesByNiveau: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.getByNiveauScolaire(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getPeriodesByYear: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.getByAnneeScolaire(req.params.year));
  } catch (error) {
    next(error);
  }
};
export const createPeriode: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await periodeService.create(req.body));
  } catch (error) {
    next(error);
  }
};
export const createManyPeriodes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const updatePeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const deletePeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyPeriodes: RequestHandler = async (req, res, next) => {
  try {
    res.json(await periodeService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};
