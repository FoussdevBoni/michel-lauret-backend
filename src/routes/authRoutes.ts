import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  login,
  me,
  enableOfflineAccess,
  changePassword,
} from '../controllers/authController';
import { authenticatedMiddleware } from '../middlewares/authenticatedMiddleware';
const router = Router();
router.post(
  '/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Trop de tentatives. Réessayez plus tard.' },
  }),
  login,
);
router.get('/me', authenticatedMiddleware, me);
router.put(
  '/password',
  authenticatedMiddleware,
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Trop de tentatives. Réessayez plus tard.' },
  }),
  changePassword,
);
router.post('/offline-access', authenticatedMiddleware, enableOfflineAccess);
export default router;
