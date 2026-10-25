import {
  getNiveauClasse,
  createManyNiveauxClasses,
  getNiveauxClassesByParent,
} from '../controllers/niveauClasseController';
import {
  deleteNiveauClasse,
  deleteManyNiveauxClasses,
} from '../controllers/niveauClasseController';
import { Router } from 'express';
import {
  createNiveauClasse,
  listNiveauxClasses,
  updateNiveauClasse,
} from '../controllers/niveauClasseController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import {
  listNiveauClasseSync,
  mutateNiveauClasseSync,
} from '../controllers/niveauClasseSyncController';

const router = Router();

router.use(administratorMiddleware);
router.get('/sync', listNiveauClasseSync);
router.post('/sync', mutateNiveauClasseSync);
router.delete('/batch', deleteManyNiveauxClasses);
router.delete('/:id', deleteNiveauClasse);
router.get('/:id', getNiveauClasse);
router.get('/by-cycle/:parentId', getNiveauxClassesByParent);
router.post('/batch', createManyNiveauxClasses);
router.get('/', listNiveauxClasses);
router.post('/', createNiveauClasse);
router.put('/:id', updateNiveauClasse);

export default router;
