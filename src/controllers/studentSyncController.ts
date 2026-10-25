import { createSyncController } from './createSyncController';
import { studentSyncService } from '../services/studentSyncService';

export const studentSyncController = createSyncController(studentSyncService);
