import { getStudentByMatricule } from '../controllers/studentController';
import { getStudent, createManyStudents } from '../controllers/studentController';
import { deleteStudent, deleteManyStudents } from '../controllers/studentController';
import { Router } from 'express';
import {
  createStudent,
  listStudents,
  updateStudent,
} from '../controllers/studentController';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { studentSyncController } from '../controllers/studentSyncController';

const router = Router();
router.use(administratorMiddleware);
router.get('/sync', studentSyncController.page);
router.post('/sync', studentSyncController.mutate);
router.delete('/batch', deleteManyStudents);
router.delete('/:id', deleteStudent);
router.get('/by-matricule/:matricule', getStudentByMatricule);
router.get('/:id', getStudent);
router.post('/batch', createManyStudents);
router.get('/', listStudents);
router.post('/', createStudent);
router.put('/:id', updateStudent);

export default router;
