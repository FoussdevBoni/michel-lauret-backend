import { Router } from 'express';
import { bulletinSyncController } from '../controllers/bulletinSyncController';
import { bulletinConfigSyncController } from '../controllers/bulletinConfigSyncController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import {
  listBulletins,
  getBulletin,
  getBulletinsByPeriode,
  getBulletinsByClasseAndPeriode,
  getBulletinByPeriodeAndInscription,
  createBulletin,
  createManyBulletins,
  saveBulletin,
  saveManyBulletins,
  updateBulletin,
  generateBulletins,
  recalculateBulletinRanks,
  deleteBulletin,
  deleteManyBulletins,
  getBulletinConfig,
  saveBulletinConfig,
  deleteBulletinConfig,
  restoreBulletin,
} from '../controllers/bulletinController';

const router = Router();
router.use(administratorMiddleware);
router.get('/sync', bulletinSyncController.page);
router.post('/sync', bulletinSyncController.mutate);
router.get('/config/sync', bulletinConfigSyncController.page);
router.post('/config/sync', bulletinConfigSyncController.mutate);
router.get('/', listBulletins);
router.get('/config', getBulletinConfig);
router.put('/config', saveBulletinConfig);
router.delete('/config', deleteBulletinConfig);
router.get('/by-periode/:periodeId', getBulletinsByPeriode);
router.get('/by-classe-and-periode/:classeId/:periodeId', getBulletinsByClasseAndPeriode);
router.get(
  '/by-periode-and-inscription/:periodeId/:inscriptionId',
  getBulletinByPeriodeAndInscription,
);
router.post('/batch', createManyBulletins);
router.put('/batch/save', saveManyBulletins);
router.post('/generate', generateBulletins);
router.post('/ranks', recalculateBulletinRanks);
router.put('/save', saveBulletin);
router.post('/', createBulletin);
router.get('/:id', getBulletin);
router.put('/:id', updateBulletin);
router.post('/:id/restore', restoreBulletin);
router.delete('/batch', deleteManyBulletins);
router.delete('/:id', deleteBulletin);
export default router;
