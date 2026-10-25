import { Student } from '../models/Student';
import { studentService, serializeStudent } from './studentService';
import { createModuleSyncService } from './createModuleSyncService';

export const studentSyncService = createModuleSyncService({
  entity: 'student',
  model: Student,
  serialize: serializeStudent,
  save: (data, id, version) =>
    id ? studentService.update(id, { ...data, version }) : studentService.create(data),
  remove: (ids) => studentService.deleteMany(ids),
});
