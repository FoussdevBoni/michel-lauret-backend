import { Periode } from '../models/Periode';
import { periodeService, serializePeriode } from './periodeService';
import { createModuleSyncService } from './createModuleSyncService';

export const periodeSyncService = createModuleSyncService({
  entity: 'periode',
  model: Periode,
  serialize: serializePeriode,
  save: (data, id, version) =>
    id ? periodeService.update(id, { ...data, version }) : periodeService.create(data),
  remove: (ids) => periodeService.deleteMany(ids),
});
