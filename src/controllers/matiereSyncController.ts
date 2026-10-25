import { createSyncController } from './createSyncController';
import { matiereSyncService } from '../services/matiereSyncService';

export const matiereSyncController = createSyncController(matiereSyncService);
