import { createSyncController } from './createSyncController';
import { evaluationSyncService } from '../services/evaluationSyncService';

export const evaluationSyncController = createSyncController(evaluationSyncService);
