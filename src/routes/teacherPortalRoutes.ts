import { Router } from 'express';
import { authenticatedMiddleware } from '../middlewares/authenticatedMiddleware';
import {
  getTeacherWorkspace,
  synchronizeTeacherNotes,
  getTeacherLogo,
} from '../controllers/teacherPortalController';
const router = Router();
router.use(authenticatedMiddleware);
router.use((_req, res, next) => {
  if (res.locals.user.role !== 'teacher') {
    res.status(403).json({ message: 'Cet espace est réservé aux enseignants.' });
    return;
  }
  next();
});
router.get('/workspace', getTeacherWorkspace);
router.get('/logo', getTeacherLogo);
router.post('/notes/sync', synchronizeTeacherNotes);
export default router;
