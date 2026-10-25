import type { RequestHandler } from 'express';
import { mediaService } from '../services/mediaService';
export const registerMediaParent: RequestHandler = async (req, res, next) => {
  try {
    res.json(await mediaService.registerParent(req.body));
  } catch (error) {
    next(error);
  }
};
export const getMedia: RequestHandler = async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await mediaService.get(req.params));
  } catch (error) {
    next(error);
  }
};
export const uploadMedia: RequestHandler = async (req, res, next) => {
  try {
    res.json(
      await mediaService.mutate(
        req.params,
        { operationId: req.body?.operationId, revision: Number(req.body?.revision) },
        res.locals.user.id,
        req.file,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const deleteMedia: RequestHandler = async (req, res, next) => {
  try {
    res.json(await mediaService.mutate(req.params, req.body, res.locals.user.id));
  } catch (error) {
    next(error);
  }
};
export const deleteManyMedia: RequestHandler = async (req, res, next) => {
  try {
    res.json(await mediaService.deleteMany(req.body?.items, res.locals.user.id));
  } catch (error) {
    next(error);
  }
};
export const uploadManyMedia: RequestHandler = async (req, res, next) => {
  try {
    res.json(
      await mediaService.uploadMany(
        req.body?.items,
        Array.isArray(req.files) ? req.files : [],
        res.locals.user.id,
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const cleanupMedia: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await mediaService.cleanup());
  } catch (error) {
    next(error);
  }
};
