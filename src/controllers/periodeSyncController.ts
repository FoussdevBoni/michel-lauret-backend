import { createSyncController } from './createSyncController';
import { periodeSyncService } from '../services/periodeSyncService';

export const periodeSyncController = createSyncController(periodeSyncService);
