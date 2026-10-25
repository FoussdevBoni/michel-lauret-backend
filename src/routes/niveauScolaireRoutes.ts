import {
  getNiveauScolaire,
  createManyNiveauxScolaires,
} from '../controllers/niveauScolaireController';
import {
  deleteNiveauScolaire,
  deleteManyNiveauxScolaires,
} from '../controllers/niveauScolaireController';
import { Router } from 'express';
import {
  createNiveauScolaire,
  listNiveauxScolaires,
  updateNiveauScolaire,
} from '../controllers/niveauScolaireController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import {
  listNiveauSync,
  mutateNiveauSync,
} from '../controllers/niveauScolaireSyncController';

const router = Router();

router.use(administratorMiddleware);
router.get('/sync', listNiveauSync);
router.post('/sync', mutateNiveauSync);
router.delete('/batch', deleteManyNiveauxScolaires);
router.delete('/:id', deleteNiveauScolaire);
router.get('/:id', getNiveauScolaire);
router.post('/batch', createManyNiveauxScolaires);
router.get('/', listNiveauxScolaires);
router.post('/', createNiveauScolaire);
router.put('/:id', updateNiveauScolaire);

export default router;
