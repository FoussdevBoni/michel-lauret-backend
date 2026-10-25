import { Router } from 'express';
import { administratorMiddleware } from '../middlewares/administratorMiddleware';
import {
  imageUploadMiddleware,
  imageBatchUploadMiddleware,
} from '../middlewares/imageUploadMiddleware';
import {
  registerMediaParent,
  getMedia,
  uploadMedia,
  uploadManyMedia,
  deleteMedia,
  deleteManyMedia,
  cleanupMedia,
} from '../controllers/mediaController';
const router = Router();
router.use(administratorMiddleware);
router.post('/parents', registerMediaParent);
router.post('/cleanup', cleanupMedia);
router.delete('/batch', deleteManyMedia);
router.post('/batch', imageBatchUploadMiddleware, uploadManyMedia);
router.get('/:entity/:targetId/:kind', getMedia);
router.put('/:entity/:targetId/:kind', imageUploadMiddleware, uploadMedia);
router.delete('/:entity/:targetId/:kind', deleteMedia);
export default router;
