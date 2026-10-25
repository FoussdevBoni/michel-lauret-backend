import {
  getClasse,
  createManyClasses,
  getClassesByParent,
} from '../controllers/classeController';
import { deleteClasse, deleteManyClasses } from '../controllers/classeController';
import { Router } from 'express';
import { createClasse, listClasses, updateClasse } from '../controllers/classeController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { classeSyncController } from '../controllers/classeSyncController';

const router = Router();

router.use(administratorMiddleware);
router.get('/sync', classeSyncController.page);
router.post('/sync', classeSyncController.mutate);
router.delete('/batch', deleteManyClasses);
router.delete('/:id', deleteClasse);
router.get('/:id', getClasse);
router.get('/by-niveau-classe/:parentId', getClassesByParent);
router.post('/batch', createManyClasses);
router.get('/', listClasses);
router.post('/', createClasse);
router.put('/:id', updateClasse);

export default router;
