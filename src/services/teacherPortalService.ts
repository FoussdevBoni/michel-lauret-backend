import { Enseignant } from '../models/Teacher';
import { Classe } from '../models/Classe';
import { Matiere } from '../models/Matiere';
import { Inscription } from '../models/Inscription';
import { Student } from '../models/Student';
import { Periode } from '../models/Periode';
import { Evaluation } from '../models/Evaluation';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { Note } from '../models/Note';
import { Etablissement } from '../models/Etablissement';
import { MediaSlot } from '../models/Media';
import { mediaService } from './mediaService';
import { HttpError } from '../utils/HttpError';
import { withTransaction } from '../lib/withTransaction';
import { serializeNote } from './noteQueryService';
import { noteService } from './noteService';
import { createModuleSyncService } from './createModuleSyncService';
import {
  teacherGradeDataSchema,
  teacherNoteRequestSchema,
} from '../types/features/TeacherPortal';

async function requireTeacher(ownerId: string, lock = false) {
  const matches = await Enseignant.find({ userId: ownerId, isDeleted: false }).limit(2);
  if (matches.length !== 1) {
    throw new HttpError(
      403,
      'Votre compte doit être rattaché à un seul dossier enseignant par la direction.',
    );
  }
  if (!lock) return matches[0];
  const record = await Enseignant.findOneAndUpdate(
    { _id: matches[0]._id, userId: ownerId, isDeleted: false },
    { $inc: { referenceRevision: 1 } },
    { new: true },
  );
  if (!record) throw new HttpError(403, 'Votre affectation n’est plus disponible.');
  return record;
}

const mutations = createModuleSyncService({
  entity: 'teacherNote',
  model: Note,
  serialize: serializeNote,
  async save(input, id, version) {
    const scoped = teacherGradeDataSchema.parse(input);
    const data = {
      inscriptionId: scoped.inscriptionId,
      matiereId: scoped.matiereId,
      periodeId: scoped.periodeId,
      evaluationId: scoped.evaluationId,
      note: scoped.note,
    };
    if (!id) return noteService.create(data);
    return noteService.update(id, { note: data.note, version });
  },
  remove: (ids) => noteService.deleteMany(ids),
});

export const teacherPortalService = {
  async logo(ownerId: string) {
    await requireTeacher(ownerId);
    const school = await Etablissement.exists({ key: 'school', isDeleted: false });
    return school
      ? mediaService.get({ entity: 'school', targetId: 'school', kind: 'logo' })
      : { revision: 0, image: null };
  },
  async snapshot(ownerId: string) {
    // One consistent read: assignments and the private pupil list belong together.
    return withTransaction(async () => {
      const teacher = await requireTeacher(ownerId);
      const classIds = teacher.enseignements.map((item) => item.classeId);
      const subjectIds = teacher.enseignements.map((item) => item.matiereId);
      const classes = await Classe.find({ _id: { $in: classIds }, isDeleted: false });
      const subjects = await Matiere.find({ _id: { $in: subjectIds }, isDeleted: false });
      const assignments = teacher.enseignements.filter(
        (item) =>
          classes.some((classe) => String(classe._id) === item.classeId) &&
          subjects.some((subject) => String(subject._id) === item.matiereId),
      );
      const allowedClasses = classes.filter((item) =>
        assignments.some((a) => a.classeId === String(item._id)),
      );
      const registrations = await Inscription.find({
        classeId: { $in: allowedClasses.map((item) => item._id) },
        isDeleted: false,
      });
      const pupils = await Student.find({
        _id: { $in: registrations.map((item) => item.eleveDataId) },
        isDeleted: false,
      }).select('nom prenom matricule');
      const schoolIds = allowedClasses.map((item) => item.niveauScolaireId);
      const levels = await NiveauScolaire.find({
        _id: { $in: schoolIds },
        isDeleted: false,
      });
      const periods = await Periode.find({
        isDeleted: false,
        $or: [{ niveauScolaireId: null }, { niveauScolaireId: { $in: schoolIds } }],
      }).sort({ ordre: 1 });
      const evaluations = await Evaluation.find({
        isDeleted: false,
        $and: [
          { $or: [{ niveauScolaireId: null }, { niveauScolaireId: { $in: schoolIds } }] },
          {
            $or: [
              { periodeId: null },
              { periodeId: { $in: periods.map((item) => item._id) } },
            ],
          },
        ],
      });
      const notes = assignments.length
        ? await Note.find({
            enseignantId: teacher._id,
            isDeleted: false,
            inscriptionId: { $in: registrations.map((item) => item._id) },
            $or: assignments.map((item) => ({
              classeId: item.classeId,
              matiereId: item.matiereId,
            })),
          })
        : [];
      const school = await Etablissement.findOne({ key: 'school', isDeleted: false });
      const logo = school
        ? await MediaSlot.findOne({
            entity: 'school',
            targetId: 'school',
            kind: 'logo',
          }).select('revision')
        : null;
      return {
        ownerId,
        teacher: {
          id: String(teacher._id),
          nom: teacher.nom,
          prenom: teacher.prenom,
          email: teacher.email,
          tel: teacher.tel,
        },
        school: {
          logoRevision: logo?.revision ?? 0,
          nom: school?.nom ?? 'CPEG Michel Lauret',
          anneeScolaire: school?.anneeScolaire ?? '',
        },
        classes: allowedClasses.map((item) => ({
          id: String(item._id),
          nom: item.nom,
          niveauScolaireId: String(item.niveauScolaireId),
          notePlafond:
            levels.find((level) => String(level._id) === String(item.niveauScolaireId))
              ?.notePlafond ?? 20,
        })),
        subjects: subjects
          .filter((item) => assignments.some((a) => a.matiereId === String(item._id)))
          .map((item) => ({
            id: String(item._id),
            nom: item.nom,
            coefficient: item.coefficient,
            classeIds: assignments
              .filter((a) => a.matiereId === String(item._id))
              .map((a) => a.classeId),
          })),
        students: registrations.flatMap((item) => {
          const pupil = pupils.find((p) => String(p._id) === String(item.eleveDataId));
          return pupil
            ? [
                {
                  id: String(item._id),
                  nom: `${pupil.prenom} ${pupil.nom}`,
                  matricule: pupil.matricule ?? '',
                  classeId: String(item.classeId),
                  anneeScolaire: item.anneeScolaire,
                  isActive: item.isActive,
                },
              ]
            : [];
        }),
        periods: periods.map((item) => ({
          id: String(item._id),
          nom: item.nom,
          niveauScolaireId: item.niveauScolaireId
            ? String(item.niveauScolaireId)
            : undefined,
          dateDebut: item.dateDebut,
          dateFin: item.dateFin,
        })),
        evaluations: evaluations.map((item) => ({
          id: String(item._id),
          nom: item.nom,
          coefficient: item.coefficient,
          periodeId: item.periodeId ? String(item.periodeId) : undefined,
          niveauScolaireId: item.niveauScolaireId
            ? String(item.niveauScolaireId)
            : undefined,
        })),
        notes: notes.map(serializeNote),
      };
    });
  },
  async mutate(ownerId: string, input: unknown) {
    const request = teacherNoteRequestSchema.parse(input);
    return withTransaction(async () => {
      const teacher = await requireTeacher(ownerId, true);
      for (const item of request.items) {
        const record = item.targetId ? await Note.findById(item.targetId) : null;
        if (item.targetId && !record)
          throw new HttpError(403, 'Cette note ne fait pas partie de votre espace.');
        if (item.action === 'save' && !item.data)
          throw new HttpError(400, 'Renseignez la note.');
        if (item.action === 'delete' && !record)
          throw new HttpError(400, 'Choisissez une note existante.');
        const registration = await Inscription.findOne({
          _id: record?.inscriptionId ?? item.data!.inscriptionId,
          isDeleted: false,
        });
        const subjectId = String(record?.matiereId ?? item.data!.matiereId);
        if (
          !registration ||
          !registration.isActive ||
          !teacher.enseignements.some(
            (a) =>
              a.classeId === String(registration.classeId) && a.matiereId === subjectId,
          )
        ) {
          throw new HttpError(
            403,
            'Vous pouvez saisir uniquement les notes des élèves de vos classes et matières affectées.',
          );
        }
        if (
          item.data &&
          (item.data.classeId !== String(registration.classeId) ||
            item.data.anneeScolaire !== registration.anneeScolaire)
        ) {
          throw new HttpError(
            409,
            'La scolarité de cet élève a changé depuis votre saisie. Faites vérifier cette note par la direction.',
          );
        }
        if (item.data) {
          const classe = await Classe.findOne({
            _id: registration.classeId,
            isDeleted: false,
          });
          const level = classe
            ? await NiveauScolaire.findOne({
                _id: classe.niveauScolaireId,
                isDeleted: false,
              })
            : null;
          const evaluation = await Evaluation.findOne({
            _id: item.data.evaluationId,
            isDeleted: false,
          });
          if (
            item.data.expectedNotePlafond !==
              (record?.notePlafond ?? level?.notePlafond) ||
            item.data.expectedCoefficient !==
              (record?.coefficient ?? evaluation?.coefficient)
          ) {
            throw new HttpError(
              409,
              'Le barème ou le coefficient a changé depuis votre saisie. Faites vérifier cette note par la direction.',
            );
          }
        }
        if (
          record &&
          (String(record.classeId) !== String(registration.classeId) ||
            record.anneeScolaire !== registration.anneeScolaire)
        ) {
          throw new HttpError(
            409,
            'La scolarité de cet élève a changé. Faites vérifier cette note par la direction.',
          );
        }
        if (record && String(record.enseignantId) !== String(teacher._id))
          throw new HttpError(403, 'Cette note appartient à un autre enseignant.');
        if (
          record &&
          item.data &&
          ['inscriptionId', 'matiereId', 'periodeId', 'evaluationId'].some(
            (key) =>
              String(record.get(key)) !== item.data![key as keyof typeof item.data],
          )
        ) {
          throw new HttpError(
            409,
            'La classe, la matière et l’évaluation d’une note ne peuvent pas être changées.',
          );
        }
      }
      return mutations.mutate(request, ownerId);
    });
  },
};
