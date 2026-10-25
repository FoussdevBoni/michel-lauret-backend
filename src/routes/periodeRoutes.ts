import { Router } from 'express';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { periodeSyncController } from '../controllers/periodeSyncController';
import {
  listPeriodes,
  getPeriode,
  getPeriodesByNiveau,
  getPeriodesByYear,
  createPeriode,
  createManyPeriodes,
  updatePeriode,
  deletePeriode,
  deleteManyPeriodes,
} from '../controllers/periodeController';
const router = Router();
router.use(administratorMiddleware);
router.get('/sync', periodeSyncController.page);
router.post('/sync', periodeSyncController.mutate);
router.get('/', listPeriodes);
router.get('/by-niveau-scolaire/:parentId', getPeriodesByNiveau);
router.get('/by-year/:year', getPeriodesByYear);
router.get('/:id', getPeriode);
router.post('/batch', createManyPeriodes);
router.post('/', createPeriode);
router.put('/:id', updatePeriode);
router.delete('/batch', deleteManyPeriodes);
router.delete('/:id', deletePeriode);
export default router;
