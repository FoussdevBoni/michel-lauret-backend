import { createSyncController } from './createSyncController';
import { classeSyncService } from '../services/classeSyncService';

export const classeSyncController = createSyncController(classeSyncService);
