import { Inscription } from '../models/Inscription';
import { Student } from '../models/Student';
import { Classe } from '../models/Classe';
import { inscriptionQuerySchema } from '../types/features/InscriptionQuery';
import { serializeInscription, inscriptionService } from './inscriptionService';

export const inscriptionQueryService = {
  getById: inscriptionService.getById,
  async getData(input: unknown = {}) {
    const { where, options } = inscriptionQuerySchema.parse(input);
    const records = await Inscription.find({
      isDeleted: false,
      ...(where.id ? { _id: where.id } : {}),
      ...(where.eleveDataId ? { eleveDataId: where.eleveDataId } : {}),
      ...(where.classeId ? { classeId: where.classeId } : {}),
      ...(where.anneeScolaire ? { anneeScolaire: where.anneeScolaire } : {}),
      ...(where.isActive !== undefined ? { isActive: where.isActive } : {}),
      ...(where.statutScolaire ? { statutScolaire: where.statutScolaire } : {}),
    });
    const students = new Map(
      (
        await Student.find({ _id: { $in: records.map((record) => record.eleveDataId) } })
          .select('nom prenom matricule')
          .lean()
      ).map((student) => [String(student._id), student]),
    );
    const classes = new Map(
      (
        await Classe.find({ _id: { $in: records.map((record) => record.classeId) } })
          .select('nom')
          .lean()
      ).map((classe) => [String(classe._id), classe.nom]),
    );
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('fr');
    const filtered = records
      .map((record) => {
        const student = students.get(String(record.eleveDataId));
        return {
          ...serializeInscription(record),
          nom: student?.nom ?? '',
          prenom: student?.prenom ?? '',
          matricule: student?.matricule ?? '',
          eleve: student ? `${student.nom} ${student.prenom}` : 'Élève indisponible',
          classe: classes.get(String(record.classeId)) ?? 'Classe indisponible',
        };
      })
      .filter(
        (record) =>
          (!where.dateInscription || record.dateInscription === where.dateInscription) &&
          (!where.recherche ||
            normalize(`${record.nom} ${record.prenom} ${record.matricule}`).includes(
              normalize(where.recherche.replaceAll('%', '')),
            )) &&
          (['nom', 'prenom', 'matricule'] as const).every(
            (key) =>
              !where[key] ||
              normalize(record[key]).includes(normalize(where[key]!.replaceAll('%', ''))),
          ),
      );
    filtered.sort(
      (first, second) =>
        (options.orderDir === 'ASC' ? 1 : -1) *
        first[options.orderBy].localeCompare(second[options.orderBy], 'fr', {
          numeric: true,
        }),
    );
    return {
      items: filtered.slice(options.offset, options.offset + options.limit),
      total: filtered.length,
      offset: options.offset,
      limit: options.limit,
    };
  },
  async getActives() {
    return this.getData({ where: { isActive: true } });
  },
  async getByEleve(eleveDataId: string) {
    return this.getData({ where: { eleveDataId } });
  },
  async getInscriptionsByEleve(eleveDataId: string) {
    return this.getByEleve(eleveDataId);
  },
  async getByClasse(classeId: string) {
    return this.getData({ where: { classeId } });
  },
  async getByAnneeScolaire(anneeScolaire: string) {
    return this.getData({ where: { anneeScolaire } });
  },
  async getCurrentInscription(eleveDataId: string, anneeScolaire?: string) {
    return (
      (
        await this.getData({
          where: {
            eleveDataId,
            isActive: true,
            ...(anneeScolaire ? { anneeScolaire } : {}),
          },
          options: { limit: 1 },
        })
      ).items[0] ?? null
    );
  },
  async search(input: unknown) {
    return this.getData(input);
  },
};
