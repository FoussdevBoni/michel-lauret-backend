import { Router } from 'express';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { evaluationSyncController } from '../controllers/evaluationSyncController';
import {
  listEvaluations,
  getEvaluation,
  getEvaluationsByPeriode,
  getEvaluationsByNiveau,
  getEvaluationsByPeriodeAndMatiere,
  createEvaluation,
  createManyEvaluations,
  updateEvaluation,
  deleteEvaluation,
  deleteManyEvaluations,
} from '../controllers/evaluationController';
const router = Router();
router.use(administratorMiddleware);
router.get('/sync', evaluationSyncController.page);
router.post('/sync', evaluationSyncController.mutate);
router.get('/', listEvaluations);
router.get('/by-periode/:parentId', getEvaluationsByPeriode);
router.get('/by-niveau-scolaire/:parentId', getEvaluationsByNiveau);
router.get(
  '/by-periode-and-matiere/:periodeId/:matiereId',
  getEvaluationsByPeriodeAndMatiere,
);
router.get('/:id', getEvaluation);
router.post('/batch', createManyEvaluations);
router.post('/', createEvaluation);
router.put('/:id', updateEvaluation);
router.delete('/batch', deleteManyEvaluations);
router.delete('/:id', deleteEvaluation);
export default router;
