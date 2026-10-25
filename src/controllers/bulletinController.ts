import type { RequestHandler } from 'express';
import { bulletinService } from '../services/bulletinService';
import { bulletinConfigService } from '../services/bulletinConfigService';

export const listBulletins: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.list(req.query));
  } catch (error) {
    next(error);
  }
};
export const getBulletin: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const getBulletinsByPeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.getByPeriode(req.params.periodeId));
  } catch (error) {
    next(error);
  }
};
export const getBulletinsByClasseAndPeriode: RequestHandler = async (req, res, next) => {
  try {
    res.json(
      await bulletinService.getByClasseAndPeriode(
        req.params.classeId,
        req.params.periodeId,
        req.query.anneeScolaire,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const getBulletinByPeriodeAndInscription: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    res.json(
      await bulletinService.getByPeriodeAndInscription(
        req.params.periodeId,
        req.params.inscriptionId,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const createBulletin: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json(await bulletinService.createUnique(req.body));
  } catch (error) {
    next(error);
  }
};
export const createManyBulletins: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.createMultiple(req.body));
  } catch (error) {
    next(error);
  }
};
export const saveBulletin: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.save(req.body));
  } catch (error) {
    next(error);
  }
};
export const saveManyBulletins: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.saveMultiple(req.body?.items));
  } catch (error) {
    next(error);
  }
};
export const updateBulletin: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const generateBulletins: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.generateMultiple(req.body));
  } catch (error) {
    next(error);
  }
};
export const recalculateBulletinRanks: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.recalculerRangs(req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteBulletin: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.delete(req.params.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyBulletins: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.deleteMany(req.body?.ids));
  } catch (error) {
    next(error);
  }
};
export const restoreBulletin: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinService.restore(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
export const getBulletinConfig: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await bulletinConfigService.getConfig());
  } catch (error) {
    next(error);
  }
};
export const saveBulletinConfig: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinConfigService.saveConfig(req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteBulletinConfig: RequestHandler = async (req, res, next) => {
  try {
    res.json(await bulletinConfigService.deleteConfig(req.body));
  } catch (error) {
    next(error);
  }
};
