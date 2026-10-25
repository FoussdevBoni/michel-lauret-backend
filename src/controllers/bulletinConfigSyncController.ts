import { createSyncController } from './createSyncController';
import { bulletinConfigSyncService } from '../services/bulletinConfigSyncService';

export const bulletinConfigSyncController = createSyncController(
  bulletinConfigSyncService,
);
