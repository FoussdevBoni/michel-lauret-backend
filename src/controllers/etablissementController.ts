import type { RequestHandler } from 'express';
import { etablissementService } from '../services/etablissementService';
import { mediaService } from '../services/mediaService';

export const getEtablissement: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await etablissementService.get());
  } catch (error) {
    next(error);
  }
};
export const getEtablissementState: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await etablissementService.getState());
  } catch (error) {
    next(error);
  }
};
export const etablissementExists: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await etablissementService.exists());
  } catch (error) {
    next(error);
  }
};
export const saveEtablissement: RequestHandler = async (req, res, next) => {
  try {
    res.json(await etablissementService.save(req.body));
  } catch (error) {
    next(error);
  }
};
export const updateEtablissement: RequestHandler = async (req, res, next) => {
  try {
    res.json(await etablissementService.update(req.body));
  } catch (error) {
    next(error);
  }
};
export const getEtablissementImage: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      await mediaService.get({
        entity: 'school',
        targetId: 'school',
        kind: req.params.kind,
      }),
    );
  } catch (error) {
    next(error);
  }
};
export const updateEtablissementImage: RequestHandler = async (req, res, next) => {
  try {
    res.json(
      await mediaService.mutate(
        { entity: 'school', targetId: 'school', kind: req.params.kind },
        { operationId: req.body?.operationId, revision: Number(req.body?.revision) },
        res.locals.user.id,
        req.file,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const deleteEtablissementImage: RequestHandler = async (req, res, next) => {
  try {
    res.json(
      await mediaService.mutate(
        { entity: 'school', targetId: 'school', kind: req.params.kind },
        req.body,
        res.locals.user.id,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const deleteEtablissement: RequestHandler = async (req, res, next) => {
  try {
    res.json(await etablissementService.delete(req.body));
  } catch (error) {
    next(error);
  }
};
export const deleteManyEtablissements: RequestHandler = async (req, res, next) => {
  try {
    res.json(await etablissementService.deleteMany(req.body));
  } catch (error) {
    next(error);
  }
};
