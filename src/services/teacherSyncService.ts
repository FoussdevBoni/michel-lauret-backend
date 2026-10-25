import { Enseignant } from '../models/Teacher';
import { teacherService } from './teacherService';
import { serializeTeacher } from './teacherQueryService';
import { createModuleSyncService } from './createModuleSyncService';

export const teacherSyncService = createModuleSyncService({
  entity: 'teacher',
  model: Enseignant,
  serialize: serializeTeacher,
  save: (data, id, version) =>
    id ? teacherService.update(id, { ...data, version }) : teacherService.create(data),
  remove: (ids) => teacherService.deleteMany(ids),
});
