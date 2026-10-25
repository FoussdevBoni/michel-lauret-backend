import { withTransaction } from '../lib/withTransaction';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Student } from '../models/Student';
import { Inscription } from '../models/Inscription';
import { inscriptionService, saveInscription } from './inscriptionService';
import { inscriptionInputSchema } from '../types/features/Inscription';
import {
  inscriptionIdsSchema,
  reenrolmentSchema,
  transferSchema,
  newStudentInscriptionSchema,
} from '../types/features/InscriptionActions';
import { runBatch } from '../utils/runBatch';
import { HttpError } from '../utils/HttpError';

function toInput(record: Awaited<ReturnType<typeof inscriptionService.getById>>) {
  return inscriptionInputSchema.parse({
    eleveDataId: record.eleveDataId,
    classeId: record.classeId,
    anneeScolaire: record.anneeScolaire,
    dateInscription: record.dateInscription,
    statutScolaire: record.statutScolaire,
    isActive: record.isActive,
  });
}

export const inscriptionActionsService = {
  async setActive(id: string, isActive: boolean) {
    const record = await inscriptionService.getById(id);
    if (record.isActive === isActive) return record;
    return inscriptionService.update(id, {
      ...toInput(record),
      isActive,
      version: record.version,
    });
  },
  async activate(id: string) {
    return this.setActive(id, true);
  },
  async deactivate(id: string) {
    return this.setActive(id, false);
  },
  async activateMany(input: unknown) {
    return runBatch<string, Awaited<ReturnType<typeof inscriptionService.getById>>>(
      inscriptionIdsSchema.parse(input),
      (id) => this.activate(id),
    );
  },
  async deactivateMany(input: unknown) {
    return runBatch<string, Awaited<ReturnType<typeof inscriptionService.getById>>>(
      inscriptionIdsSchema.parse(input),
      (id) => this.deactivate(id),
    );
  },
  async reenrolMany(input: unknown) {
    const { eleveDataIds, ...data } = reenrolmentSchema.parse(input);
    return runBatch<string, Awaited<ReturnType<typeof inscriptionService.create>>>(
      eleveDataIds,
      (eleveDataId) =>
        inscriptionService.create({ ...data, eleveDataId, isActive: true }),
    );
  },
  async transferMany(input: unknown) {
    const data = transferSchema.parse(input);
    return runBatch<string, Awaited<ReturnType<typeof inscriptionService.create>>>(
      data.ids,
      async (id) =>
        withTransaction(async (session) => {
          const source = await Inscription.findOne({ _id: id, isDeleted: false }).session(
            session,
          );
          if (!source) throw new HttpError(404, 'Inscription introuvable.');
          if (!source.isActive)
            throw new HttpError(
              409,
              'Seule une inscription active peut être transférée.',
            );
          if (String(source.classeId) === data.classeId)
            throw new HttpError(409, 'L’élève est déjà dans cette classe.');
          const target = await Inscription.findOne({
            eleveDataId: source.eleveDataId,
            classeId: data.classeId,
            anneeScolaire: source.anneeScolaire,
            isDeleted: false,
          }).session(session);
          return saveInscription(
            {
              eleveDataId: String(source.eleveDataId),
              classeId: data.classeId,
              anneeScolaire: source.anneeScolaire,
              dateInscription: data.dateInscription,
              statutScolaire: 'transfert',
              isActive: true,
              ...(target ? { version: target.__v } : {}),
            },
            target ? String(target._id) : undefined,
            session,
          );
        }),
    );
  },
  async createNewStudent(input: unknown) {
    const data = newStudentInscriptionSchema.parse(input);
    if (mongoose.connection.readyState !== 1)
      throw new HttpError(503, 'La base de données est indisponible.');
    return withTransaction(async (session) => {
      const matricule =
        data.student.matricule ||
        `EL-${new Date().getFullYear()}-${randomUUID().replaceAll('-', '').toUpperCase()}`;
      const [student] = await Student.create([{ ...data.student, matricule }], {
        session,
      });
      const inscription = await saveInscription(
        { ...data.inscription, eleveDataId: String(student._id) },
        undefined,
        session,
      );
      return {
        student: {
          ...data.student,
          matricule,
          id: String(student._id),
          isDeleted: false,
          version: student.__v,
          createdAt: student.createdAt.toISOString(),
          updatedAt: student.updatedAt.toISOString(),
        },
        inscription,
      };
    });
  },
};
