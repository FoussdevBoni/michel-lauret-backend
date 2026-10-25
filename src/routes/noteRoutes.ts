import { Router } from 'express';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { noteSyncController } from '../controllers/noteSyncController';
import {
  listNotes,
  getNote,
  getNotesByInscription,
  getNotesByMatiere,
  getNotesByPeriode,
  getNotesByClasse,
  getNotesByEleve,
  createNote,
  createBatchNotes,
  updateNote,
  closeNote,
  closeBatchNotes,
  importNotes,
  deleteNote,
  deleteManyNotes,
} from '../controllers/noteController';
const router = Router();
router.use(administratorMiddleware);
router.get('/sync', noteSyncController.page);
router.post('/sync', noteSyncController.mutate);
router.get('/', listNotes);
router.get('/by-inscription/:parentId', getNotesByInscription);
router.get('/by-matiere/:parentId', getNotesByMatiere);
router.get('/by-periode/:parentId', getNotesByPeriode);
router.get('/by-classe/:parentId', getNotesByClasse);
router.get('/by-student/:parentId', getNotesByEleve);
router.get('/:id', getNote);
router.post('/batch', createBatchNotes);
router.post('/import', importNotes);
router.post('/', createNote);
router.put('/:id', updateNote);
router.patch('/batch/close', closeBatchNotes);
router.patch('/:id/close', closeNote);
router.delete('/batch', deleteManyNotes);
router.delete('/:id', deleteNote);
export default router;
