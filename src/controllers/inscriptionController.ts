import { inscriptionActionsService } from '../services/inscriptionActionsService';
import { inscriptionSchoolLifeService } from '../services/inscriptionSchoolLifeService';
import { inscriptionQueryService } from '../services/inscriptionQueryService';
import { HttpError } from '../utils/HttpError';

export const updateInscriptionSchoolLife: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionSchoolLifeService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
import type { RequestHandler } from 'express';
import { inscriptionService } from '../services/inscriptionService';

export const listInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const createInscription: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await inscriptionService.create(req.body));
  } catch (error) {
    next(error);
  }
};
export const updateInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const activateInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.activate(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const deactivateInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.deactivate(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const activateManyInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.activateMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const deactivateManyInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.deactivateMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};

export const reenrolInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.reenrolMany(req.body));
  } catch (error) {
    next(error);
  }
};

export const transferInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.transferMany(req.body));
  } catch (error) {
    next(error);
  }
};

export const createNewStudentInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionActionsService.createNewStudent(req.body));
  } catch (error) {
    next(error);
  }
};

export const getInscription: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionQueryService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const getActiveInscriptions: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await inscriptionQueryService.getActives());
  } catch (error) {
    next(error);
  }
};

export const getInscriptionsByStudent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionQueryService.getByEleve(req.params.eleveDataId));
  } catch (error) {
    next(error);
  }
};

export const getInscriptionsByClasse: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionQueryService.getByClasse(req.params.classeId));
  } catch (error) {
    next(error);
  }
};

export const getInscriptionsByYear: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionQueryService.getByAnneeScolaire(req.params.anneeScolaire));
  } catch (error) {
    next(error);
  }
};

export const searchInscriptions: RequestHandler = async (req, res, next) => {
  try {
    res.json(await inscriptionQueryService.search(req.body));
  } catch (error) {
    next(error);
  }
};

export const getCurrentInscription: RequestHandler = async (req, res, next) => {
  try {
    if (
      req.query.anneeScolaire !== undefined &&
      typeof req.query.anneeScolaire !== 'string'
    )
      throw new HttpError(400, 'Année invalide.');
    res.json(
      await inscriptionQueryService.getCurrentInscription(
        req.params.eleveDataId,
        req.query.anneeScolaire,
      ),
    );
  } catch (error) {
    next(error);
  }
};
