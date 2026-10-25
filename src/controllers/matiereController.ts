import type { RequestHandler } from 'express';
import { matiereService } from '../services/matiereService';
export const listMatieres: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const getMatiere: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const getMatieresByNiveau: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.getByNiveauClasse(req.params.parentId));
  } catch (error) {
    next(error);
  }
};
export const createMatiere: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await matiereService.create(req.body));
  } catch (error) {
    next(error);
  }
};
export const createManyMatieres: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.createMany(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const updateMatiere: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteMatiere: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyMatieres: RequestHandler = async (req, res, next) => {
  try {
    res.json(await matiereService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};
