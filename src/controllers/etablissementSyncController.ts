import { createSyncController } from './createSyncController';
import { etablissementSyncService } from '../services/etablissementSyncService';

export const etablissementSyncController = createSyncController(etablissementSyncService);
