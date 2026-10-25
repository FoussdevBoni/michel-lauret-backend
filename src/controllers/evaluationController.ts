import type { RequestHandler } from 'express';
import { evaluationService } from '../services/evaluationService';
export const listEvaluations: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const getEvaluation: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const getEvaluationsByPeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.getByPeriode(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getEvaluationsByNiveau: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.getByNiveauScolaire(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const getEvaluationsByPeriodeAndMatiere: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    res.json(
      await evaluationService.getByPeriodeAndMatiere(
        req.params.periodeId,
        req.params.matiereId,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const createEvaluation: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await evaluationService.create(req.body));
  } catch (error) {
    next(error);
  }
};
export const createManyEvaluations: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const updateEvaluation: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteEvaluation: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyEvaluations: RequestHandler = async (req, res, next) => {
  try {
    res.json(await evaluationService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};
