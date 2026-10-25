import { Router } from 'express';
import { etablissementSyncController } from '../controllers/etablissementSyncController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { imageUploadMiddleware } from '../middlewares/imageUploadMiddleware';
import {
  getEtablissement,
  getEtablissementState,
  etablissementExists,
  saveEtablissement,
  updateEtablissement,
  getEtablissementImage,
  updateEtablissementImage,
  deleteEtablissementImage,
  deleteEtablissement,
  deleteManyEtablissements,
} from '../controllers/etablissementController';

const router = Router();
router.use(administratorMiddleware);
router.get('/sync', etablissementSyncController.page);
router.post('/sync', etablissementSyncController.mutate);
router.get('/', getEtablissement);
router.get('/state', getEtablissementState);
router.get('/exists', etablissementExists);
router.get('/images/:kind', getEtablissementImage);
router.put('/images/:kind', imageUploadMiddleware, updateEtablissementImage);
router.delete('/images/:kind', deleteEtablissementImage);
router.post('/', saveEtablissement);
router.put('/', saveEtablissement);
router.patch('/', updateEtablissement);
router.delete('/batch', deleteManyEtablissements);
router.delete('/', deleteEtablissement);
export default router;
