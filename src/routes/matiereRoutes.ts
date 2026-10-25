import { Router } from 'express';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { matiereSyncController } from '../controllers/matiereSyncController';
import {
  listMatieres,
  getMatiere,
  getMatieresByNiveau,
  createMatiere,
  createManyMatieres,
  updateMatiere,
  deleteMatiere,
  deleteManyMatieres,
} from '../controllers/matiereController';
const router = Router();
router.use(administratorMiddleware);
router.get('/sync', matiereSyncController.page);
router.post('/sync', matiereSyncController.mutate);
router.get('/', listMatieres);
router.get('/by-niveau-classe/:parentId', getMatieresByNiveau);
router.get('/:id', getMatiere);
router.post('/batch', createManyMatieres);
router.post('/', createMatiere);
router.put('/:id', updateMatiere);
router.delete('/batch', deleteManyMatieres);
router.delete('/:id', deleteMatiere);
export default router;
