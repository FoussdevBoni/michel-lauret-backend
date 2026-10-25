import { withTransaction } from '../lib/withTransaction';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Note } from '../models/Note';
import { Student } from '../models/Student';
import { Inscription } from '../models/Inscription';
import {
  noteInputSchema,
  noteUpdateSchema,
  noteCloseSchema,
  noteImportSchema,
  noteImportRowSchema,
} from '../types/features/Note';
import { noteQueryService, serializeNote } from './noteQueryService';
import { requireNoteContext } from './noteContextService';
import { markNoteBulletinDirty } from './noteBulletinService';
import { deletionService } from './deletionService';
import { runBatch } from '../utils/runBatch';
import { HttpError } from '../utils/HttpError';
export const noteService = {
  ...noteQueryService,
  async create(input: unknown) {
    const data = noteInputSchema.parse(input);
    return withTransaction(async (session) => {
      const context = await requireNoteContext(data, session);
      if (data.note > context.notePlafond)
        throw new HttpError(400, 'La note dépasse le barème.');
      if (
        await Note.exists({
          inscriptionId: data.inscriptionId,
          matiereId: data.matiereId,
          periodeId: data.periodeId,
          evaluationId: data.evaluationId,
          isDeleted: false,
        }).session(session)
      )
        throw new HttpError(409, 'Une note existe déjà pour cette évaluation.');
      const [record] = await Note.create([{ ...context, note: data.note }], { session });
      await markNoteBulletinDirty(context, session);
      return serializeNote(record);
    });
  },
  createBatch: (items: unknown) => runBatch(items, (item) => noteService.create(item)),
  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant note invalide.');
    const data = noteUpdateSchema.parse(input);
    return withTransaction(async (session) => {
      const record = await Note.findOne({ _id: id, isDeleted: false }).session(session);
      if (!record) throw new HttpError(404, 'Note introuvable.');
      if (record.closed)
        throw new HttpError(409, 'Une note clôturée ne peut pas être modifiée.');
      if (record.__v !== data.version)
        throw new HttpError(409, 'Cette note a été modifiée ailleurs.');
      const context = await requireNoteContext(
        {
          inscriptionId: String(record.inscriptionId),
          matiereId: String(record.matiereId),
          periodeId: String(record.periodeId),
          evaluationId: String(record.evaluationId),
          note: data.note,
          notePlafond: data.notePlafond ?? record.notePlafond,
          coefficient: data.coefficient ?? record.coefficient,
        },
        session,
      );
      if (data.note > context.notePlafond)
        throw new HttpError(400, 'La note dépasse le barème.');
      if (String(record.enseignantId) !== String(context.enseignantId))
        throw new HttpError(409, 'L’affectation de cette note a changé.');
      record.set({
        note: data.note,
        notePlafond: context.notePlafond,
        coefficient: context.coefficient,
      });
      record.increment();
      await markNoteBulletinDirty(context, session);
      return serializeNote(await record.save({ session }));
    });
  },
  async close(id: string, input: unknown) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant note invalide.');
    const { version } = noteCloseSchema.parse(input);
    return withTransaction(async (session) => {
      const record = await Note.findOne({ _id: id, isDeleted: false }).session(session);
      if (!record) throw new HttpError(404, 'Note introuvable.');
      if (record.closed) throw new HttpError(409, 'Cette note est déjà clôturée.');
      if (record.__v !== version)
        throw new HttpError(409, 'Cette note a été modifiée ailleurs.');
      await markNoteBulletinDirty(record, session);
      record.closed = true;
      record.closedAt = new Date();
      record.increment();
      return serializeNote(await record.save({ session }));
    });
  },
  closeBatch: (items: unknown) =>
    runBatch(items, (item) => {
      const parsed = z
        .object({
          id: z.string().regex(/^[a-f0-9]{24}$/i),
          version: z.number().int().nonnegative(),
        })
        .strict()
        .parse(item);
      return noteService.close(parsed.id, { version: parsed.version });
    }),
  async importFromExcel(input: unknown) {
    const data = noteImportSchema.parse(input);
    return runBatch(data.notes, async (item) => {
      const row = noteImportRowSchema.parse(item);
      const student = await Student.findOne({
        matricule: row.matricule,
        isDeleted: false,
      });
      if (!student) throw new HttpError(404, 'Matricule introuvable.');
      const inscription = await Inscription.findOne({
        eleveDataId: student._id,
        classeId: data.classeId,
        anneeScolaire: data.anneeScolaire,
        isDeleted: false,
      });
      if (!inscription)
        throw new HttpError(
          404,
          'Aucune inscription pour ce matricule dans la classe et l’année choisies.',
        );
      return noteService.create({
        inscriptionId: String(inscription._id),
        matiereId: data.matiereId,
        periodeId: data.periodeId,
        evaluationId: data.evaluationId,
        note: row.note,
        notePlafond: data.notePlafond,
      });
    });
  },
  delete: (id: string) => deletionService.deleteMany('note', [id]),
  deleteMany: (ids: unknown) => deletionService.deleteMany('note', ids),
};
