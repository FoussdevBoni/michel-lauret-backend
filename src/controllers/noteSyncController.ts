import { createSyncController } from './createSyncController';
import { noteSyncService } from '../services/noteSyncService';

export const noteSyncController = createSyncController(noteSyncService);
