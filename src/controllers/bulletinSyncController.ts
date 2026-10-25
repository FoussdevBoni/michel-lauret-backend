import { createSyncController } from './createSyncController';
import { bulletinSyncService } from '../services/bulletinSyncService';

export const bulletinSyncController = createSyncController(bulletinSyncService);
