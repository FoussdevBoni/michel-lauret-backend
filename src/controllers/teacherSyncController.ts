import { createSyncController } from './createSyncController';
import { teacherSyncService } from '../services/teacherSyncService';

export const teacherSyncController = createSyncController(teacherSyncService);
