import { Evaluation } from '../models/Evaluation';
import { evaluationService } from './evaluationService';
import { serializeEvaluation } from './evaluationQueryService';
import { createModuleSyncService } from './createModuleSyncService';

export const evaluationSyncService = createModuleSyncService({
  entity: 'evaluation',
  model: Evaluation,
  serialize: serializeEvaluation,
  save: (data, id, version) =>
    id
      ? evaluationService.update(id, { ...data, version })
      : evaluationService.create(data),
  remove: (ids) => evaluationService.deleteMany(ids),
});
