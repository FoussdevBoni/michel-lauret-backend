import { z } from 'zod';
import { Note } from '../models/Note';
import { noteInputSchema } from '../types/features/Note';
import { noteService } from './noteService';
import { serializeNote } from './noteQueryService';
import { createModuleSyncService } from './createModuleSyncService';
import { HttpError } from '../utils/HttpError';

const inputSchema = noteInputSchema.extend({ closed: z.boolean() });

export const noteSyncService = createModuleSyncService({
  entity: 'note',
  model: Note,
  serialize: serializeNote,
  async save(input, id, version) {
    const { closed, ...data } = inputSchema.parse(input);
    const previous = id ? await Note.findById(id) : null;
    if (previous) {
      for (const field of [
        'inscriptionId',
        'matiereId',
        'periodeId',
        'evaluationId',
      ] as const)
        if (String(previous[field]) !== data[field])
          throw new HttpError(409, 'L’identité pédagogique de cette note est fixe.');
      if (previous.closed) {
        if (
          !closed ||
          previous.note !== data.note ||
          previous.notePlafond !== data.notePlafond ||
          previous.coefficient !== data.coefficient
        )
          throw new HttpError(
            409,
            'Une note clôturée ne peut pas être modifiée ou rouverte.',
          );
        return { id: String(previous._id) };
      }
    }
    const unchanged =
      previous &&
      previous.note === data.note &&
      previous.notePlafond === data.notePlafond &&
      previous.coefficient === data.coefficient;
    const record = unchanged
      ? serializeNote(previous!)
      : id
        ? await noteService.update(id, {
            note: data.note,
            notePlafond: data.notePlafond,
            coefficient: data.coefficient,
            version,
          })
        : await noteService.create(data);
    if (closed) await noteService.close(record.id, { version: record.version });
    return { id: record.id };
  },
  remove: (ids) => noteService.deleteMany(ids),
});
