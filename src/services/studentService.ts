import { runBatch } from '../utils/runBatch';
import { deletionService } from './deletionService';
import { randomUUID } from 'node:crypto';
import { isValidObjectId } from 'mongoose';
import { Student, type IStudent } from '../models/Student';
import { studentInputSchema, studentUpdateSchema } from '../types/features/Student';
import { HttpError } from '../utils/HttpError';

export function serializeStudent(student: IStudent) {
  return {
    id: String(student._id),
    nom: student.nom,
    prenom: student.prenom,
    dateNaissance: student.dateNaissance?.toISOString().slice(0, 10) ?? '',
    sexe: student.sexe,
    matricule: student.matricule ?? '',
    lieuDeNaissance: student.lieuDeNaissance ?? '',
    contact: student.contact ?? '',
    statut: student.statut ?? 'actif',
    isDeleted: student.isDeleted,
    version: student.__v,
    createdAt: student.createdAt.toISOString(),
    updatedAt: student.updatedAt.toISOString(),
  };
}

export const studentService = {
  async getByMatricule(matricule: string) {
    const record = await Student.findOne({
      matricule: matricule.trim().toUpperCase(),
      isDeleted: false,
    });
    if (!record) throw new HttpError(404, 'Élève introuvable.');
    return serializeStudent(record);
  },
  async getById(id: string) {
    if (!isValidObjectId(id)) throw new HttpError(400, 'Identifiant invalide.');
    const record = await Student.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Élément introuvable.');
    return serializeStudent(record);
  },
  async createMany(items: unknown) {
    return runBatch(items, (item) => studentService.create(item));
  },
  async list() {
    const students = await Student.find({ isDeleted: false }).sort({ nom: 1, prenom: 1 });
    return students.map(serializeStudent);
  },

  async create(input: unknown) {
    const data = studentInputSchema.parse(input);
    const matricule =
      data.matricule ||
      `EL-${new Date().getFullYear()}-${randomUUID().replaceAll('-', '').toUpperCase()}`;
    return serializeStudent(
      await Student.create({
        ...data,
        matricule,
        dateNaissance: data.dateNaissance || null,
      }),
    );
  },

  async update(id: string, input: unknown) {
    if (!isValidObjectId(id)) {
      throw new HttpError(400, 'Identifiant élève invalide.');
    }

    const { version, ...data } = studentUpdateSchema.parse(input);
    const existing = await Student.findOne({ _id: id, isDeleted: false });

    if (!existing) {
      throw new HttpError(404, 'Dossier élève introuvable.');
    }

    const matricule = data.matricule || existing.matricule;
    const student = await Student.findOneAndUpdate(
      { _id: id, isDeleted: false, __v: version },
      {
        $set: { ...data, matricule, dateNaissance: data.dateNaissance || null },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    );

    if (!student) {
      throw new HttpError(
        409,
        'Ce dossier a été modifié ailleurs. Rechargez les données.',
      );
    }

    return serializeStudent(student);
  },
  async delete(id: string) {
    return deletionService.deleteMany('student', [id]);
  },
  async deleteMany(ids: unknown) {
    return deletionService.deleteMany('student', ids);
  },
};
