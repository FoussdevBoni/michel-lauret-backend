import {
  activateInscription,
  deactivateInscription,
  activateManyInscriptions,
  deactivateManyInscriptions,
  reenrolInscriptions,
  transferInscriptions,
  createNewStudentInscription,
  getInscription,
  getActiveInscriptions,
  getInscriptionsByStudent,
  getInscriptionsByClasse,
  getInscriptionsByYear,
  searchInscriptions,
  getCurrentInscription,
} from '../controllers/inscriptionController';
import { Router } from 'express';
import { updateInscriptionSchoolLife } from '../controllers/inscriptionController';
import {
  listInscriptions,
  createInscription,
  updateInscription,
  deleteInscription,
  deleteManyInscriptions,
} from '../controllers/inscriptionController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { inscriptionSyncController } from '../controllers/inscriptionSyncController';

const router = Router();
router.use(administratorMiddleware);
router.get('/sync', inscriptionSyncController.page);
router.post('/sync', inscriptionSyncController.mutate);
router.patch('/:id/school-life', updateInscriptionSchoolLife);
router.get('/active', getActiveInscriptions);
router.post('/search', searchInscriptions);
router.get('/by-student/:eleveDataId', getInscriptionsByStudent);
router.get('/by-student/:eleveDataId/current', getCurrentInscription);
router.get('/by-classe/:classeId', getInscriptionsByClasse);
router.get('/by-year/:anneeScolaire', getInscriptionsByYear);
router.get('/:id', getInscription);
router.post('/new-student', createNewStudentInscription);
router.post('/reenrol', reenrolInscriptions);
router.post('/transfer', transferInscriptions);
router.patch('/batch/activate', activateManyInscriptions);
router.patch('/batch/deactivate', deactivateManyInscriptions);
router.patch('/:id/activate', activateInscription);
router.patch('/:id/deactivate', deactivateInscription);
router.get('/', listInscriptions);
router.post('/', createInscription);
router.put('/:id', updateInscription);
router.delete('/batch', deleteManyInscriptions);
router.delete('/:id', deleteInscription);
export default router;
