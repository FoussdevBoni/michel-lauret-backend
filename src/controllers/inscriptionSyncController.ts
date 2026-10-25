import { createSyncController } from './createSyncController';
import { inscriptionSyncService } from '../services/inscriptionSyncService';

export const inscriptionSyncController = createSyncController(inscriptionSyncService);
