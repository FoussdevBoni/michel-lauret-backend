import { Classe } from '../models/Classe';
import { classeService, serializeClasse } from './classeService';
import { createModuleSyncService } from './createModuleSyncService';

export const classeSyncService = createModuleSyncService({
  entity: 'classe',
  model: Classe,
  serialize: serializeClasse,
  save: (data, id, version) =>
    id ? classeService.update(id, { ...data, version }) : classeService.create(data),
  remove: (ids) => classeService.deleteMany(ids),
});
