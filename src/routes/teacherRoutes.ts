import {
  getTeacherAccount,
  createTeacherAccount,
  updateTeacherAccount,
} from '../controllers/teacherAccountController';
import { Router } from 'express';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import { teacherSyncController } from '../controllers/teacherSyncController';
import {
  listTeachers,
  getTeacher,
  getTeachersByClasse,
  getTeachersByMatiere,
  searchTeachers,
  createTeacher,
  createManyTeachers,
  updateTeacher,
  deleteTeacher,
  deleteManyTeachers,
} from '../controllers/teacherController';
const router = Router();
router.use(administratorMiddleware);
router.get('/sync', teacherSyncController.page);
router.post('/sync', teacherSyncController.mutate);
router.get('/', listTeachers);
router.get('/by-classe/:parentId', getTeachersByClasse);
router.get('/by-matiere/:parentId', getTeachersByMatiere);
router.get('/:id/account', getTeacherAccount);
router.post('/:id/account', createTeacherAccount);
router.put('/:id/account', updateTeacherAccount);
router.get('/:id', getTeacher);
router.post('/search', searchTeachers);
router.post('/batch', createManyTeachers);
router.post('/', createTeacher);
router.put('/:id', updateTeacher);
router.delete('/batch', deleteManyTeachers);
router.delete('/:id', deleteTeacher);
export default router;
