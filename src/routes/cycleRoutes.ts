import {
  getCycle,
  createManyCycles,
  getCyclesByParent,
} from '../controllers/cycleController';
import { deleteCycle, deleteManyCycles } from '../controllers/cycleController';
import { Router } from 'express';
import { createCycle, listCycles, updateCycle } from '../controllers/cycleController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { listCycleSync, mutateCycleSync } from '../controllers/cycleSyncController';

const router = Router();

router.use(administratorMiddleware);
router.get('/sync', listCycleSync);
router.post('/sync', mutateCycleSync);
router.delete('/batch', deleteManyCycles);
router.delete('/:id', deleteCycle);
router.get('/:id', getCycle);
router.get('/by-niveau-scolaire/:parentId', getCyclesByParent);
router.post('/batch', createManyCycles);
router.get('/', listCycles);
router.post('/', createCycle);
router.put('/:id', updateCycle);

export default router;
