import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { Enseignant, type IEnseignant } from '../models/Teacher';
import { Classe } from '../models/Classe';
import { Matiere } from '../models/Matiere';
import { NiveauClasse } from '../models/NiveauClasse';
import { Cycle } from '../models/Cycle';
import { NiveauScolaire } from '../models/NiveauScolaire';
import { HttpError } from '../utils/HttpError';
export function serializeTeacher(record: IEnseignant) {
  return {
    id: String(record._id),
    nom: record.nom,
    prenom: record.prenom,
    email: record.email ?? '',
    tel: record.tel ?? '',
    enseignements: record.enseignements.map((item) => ({
      classeId: item.classeId,
      matiereId: item.matiereId,
    })),
    version: record.__v,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
async function enrich(records: IEnseignant[]) {
  const assignments = records.flatMap((record) => record.enseignements);
  const classes = await Classe.find({
    _id: { $in: assignments.map((item) => item.classeId) },
  });
  const matieres = await Matiere.find({
    _id: { $in: assignments.map((item) => item.matiereId) },
  });
  const niveaux = await NiveauClasse.find({
    _id: { $in: classes.map((item) => item.niveauClasseId) },
  });
  const cycles = await Cycle.find({ _id: { $in: classes.map((item) => item.cycleId) } });
  const parents = await NiveauScolaire.find({
    _id: { $in: classes.map((item) => item.niveauScolaireId) },
  });
  const names = (items: { _id: unknown; nom: string }[]) =>
    new Map(items.map((item) => [String(item._id), item.nom]));
  const c = new Map(classes.map((item) => [String(item._id), item])),
    m = names(matieres),
    n = names(niveaux),
    cy = names(cycles),
    p = names(parents);
  return records.map((record) => ({
    ...serializeTeacher(record),
    enseignementsData: record.enseignements.map((item) => {
      const classe = c.get(item.classeId);
      return {
        ...item,
        classe: classe?.nom ?? 'Classe indisponible',
        matiere: m.get(item.matiereId) ?? 'Matière indisponible',
        niveauClasse: n.get(String(classe?.niveauClasseId)) ?? 'Niveau indisponible',
        cycle: cy.get(String(classe?.cycleId)) ?? 'Cycle indisponible',
        niveauScolaire: p.get(String(classe?.niveauScolaireId)) ?? 'Niveau indisponible',
      };
    }),
  }));
}
export const teacherQueryService = {
  async list(input: unknown = {}) {
    const identifier = z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase());
    const filters = z
      .object({
        niveauScolaireId: identifier.optional(),
        cycleId: identifier.optional(),
        niveauClasseId: identifier.optional(),
        classeId: identifier.optional(),
        matiereId: identifier.optional(),
        recherche: z.string().trim().max(100).optional(),
      })
      .strict()
      .parse(input);
    const hasParents = Boolean(
      filters.niveauScolaireId || filters.cycleId || filters.niveauClasseId,
    );
    const matchingClasses = hasParents
      ? await Classe.find({
          isDeleted: false,
          ...(filters.niveauScolaireId
            ? { niveauScolaireId: filters.niveauScolaireId }
            : {}),
          ...(filters.cycleId ? { cycleId: filters.cycleId } : {}),
          ...(filters.niveauClasseId ? { niveauClasseId: filters.niveauClasseId } : {}),
          ...(filters.classeId ? { _id: filters.classeId } : {}),
        }).select('_id')
      : [];
    const assignmentFilter = {
      ...(hasParents
        ? { classeId: { $in: matchingClasses.map((record) => String(record._id)) } }
        : filters.classeId
          ? { classeId: filters.classeId }
          : {}),
      ...(filters.matiereId ? { matiereId: filters.matiereId } : {}),
    };
    const records = await enrich(
      await Enseignant.find({
        isDeleted: false,
        ...(Object.keys(assignmentFilter).length
          ? { enseignements: { $elemMatch: assignmentFilter } }
          : {}),
      }).sort({ nom: 1, prenom: 1 }),
    );
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return filters.recherche
      ? records.filter((item) =>
          normalize(
            [
              item.nom,
              item.prenom,
              item.email,
              ...item.enseignementsData.flatMap((row) => [row.classe, row.matiere]),
            ].join(' '),
          ).includes(normalize(filters.recherche!)),
        )
      : records;
  },
  async getById(id: string) {
    if (!isValidObjectId(id))
      throw new HttpError(400, 'Identifiant enseignant invalide.');
    const record = await Enseignant.findOne({ _id: id, isDeleted: false });
    if (!record) throw new HttpError(404, 'Enseignant introuvable.');
    return (await enrich([record]))[0];
  },
  getByClasse: (id: string) => teacherQueryService.list({ classeId: id }),
  getByMatiere: (id: string) => teacherQueryService.list({ matiereId: id }),
  search: (term: unknown) =>
    teacherQueryService.list({ recherche: z.string().trim().max(100).parse(term) }),
};
