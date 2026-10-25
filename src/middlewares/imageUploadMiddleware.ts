import multer from 'multer';
import type { RequestHandler } from 'express';
import { MAX_SCHOOL_IMAGE_BYTES } from '../types/features/Etablissement';
import { HttpError } from '../utils/HttpError';

const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCHOOL_IMAGE_BYTES, files: 1, fields: 2, fieldSize: 100 },
}).single('file');
export const imageUploadMiddleware: RequestHandler = (req, res, next) => {
  parse(req, res, (error) => {
    if (error) {
      next(new HttpError(400, 'Un seul fichier image de 128 Ko maximum est accepté.'));
      return;
    }
    if (!req.file) {
      next(new HttpError(400, 'Choisissez une image.'));
      return;
    }
    next();
  });
};
const parseMany = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCHOOL_IMAGE_BYTES, files: 100, fields: 1, fieldSize: 64000 },
}).array('files', 100);
export const imageBatchUploadMiddleware: RequestHandler = (req, res, next) => {
  parseMany(req, res, (error) => {
    if (error) {
      next(new HttpError(400, 'Le lot accepte au maximum 100 images de 128 Ko chacune.'));
      return;
    }
    next();
  });
};
