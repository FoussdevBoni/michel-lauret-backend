import { Matiere } from '../models/Matiere';
import { matiereService, serializeMatiere } from './matiereService';
import { createModuleSyncService } from './createModuleSyncService';

export const matiereSyncService = createModuleSyncService({
  entity: 'matiere',
  model: Matiere,
  serialize: serializeMatiere,
  save: (data, id, version) =>
    id ? matiereService.update(id, { ...data, version }) : matiereService.create(data),
  remove: (ids) => matiereService.deleteMany(ids),
});
