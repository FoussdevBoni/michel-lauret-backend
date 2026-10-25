import type { Bulletin, BulletinConfig, BulletinLine } from '../types/features/Bulletin';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
type EvaluationType = keyof BulletinConfig;
interface CalculationInput {
  matieres: { id: string; nom: string; coefficient: number }[];
  evaluations: {
    id: string;
    nom: string;
    abreviation: string;
    type: EvaluationType;
    obligatoire?: boolean;
  }[];
  notes: {
    matiereId: string;
    evaluationId: string;
    note: number;
    notePlafond: number;
    coefficient: number;
  }[];
  conduite: number | null;
  config: BulletinConfig;
}
export function appreciation(value: number) {
  const labels = [
    'Très insuffisant',
    'Médiocre',
    'Insuffisant',
    'Passable',
    'Assez bien',
    'Bien',
    'Très bien',
    'Excellent',
  ];
  const thresholds = [6, 8, 10, 12, 14, 16, 18];
  return labels[thresholds.filter((threshold) => value >= threshold).length];
}
export function calculateBulletin(input: CalculationInput) {
  const expected = input.evaluations.filter(
    (evaluation) => input.config[evaluation.type].actif,
  );
  const notesManquantes: Bulletin['notesManquantes'] = [];
  const lines: BulletinLine[] = input.matieres.map((matiere) => {
    const notes = input.notes.filter((note) => note.matiereId === matiere.id);
    const missing = expected.filter(
      (evaluation) =>
        evaluation.obligatoire !== false &&
        !notes.some((note) => note.evaluationId === evaluation.id),
    );
    const hasNotes = expected.some((evaluation) =>
      notes.some((note) => note.evaluationId === evaluation.id),
    );
    if (missing.length || !expected.length || !hasNotes) {
      notesManquantes.push({
        matiereId: matiere.id,
        matiere: matiere.nom,
        evaluationsManquantes: missing.length
          ? missing.map((evaluation) => evaluation.nom)
          : !expected.length
            ? ['Aucune évaluation applicable active.']
            : ['Aucune note saisie pour cette matière.'],
      });
    }
    const items: BulletinLine['notes'] = [];
    for (const type of ['interrogation', 'devoir', 'composition'] as const) {
      const rule = input.config[type];
      if (!rule.actif) continue;
      const values = expected
        .filter((evaluation) => evaluation.type === type)
        .flatMap((evaluation) => {
          const note = notes.find(
            (candidate) => candidate.evaluationId === evaluation.id,
          );
          return note
            ? [
                {
                  evaluationId: evaluation.id,
                  nom: evaluation.abreviation || evaluation.nom,
                  note: (note.note * 20) / note.notePlafond,
                  coefficient: note.coefficient,
                },
              ]
            : [];
        });
      if (rule.mode === 'moyenne' && values.length) {
        const weight = values.reduce((sum, value) => sum + value.coefficient, 0);
        items.push({
          evaluationId: type,
          nom: `Moy. ${type}`,
          note:
            values.reduce((sum, value) => sum + value.note * value.coefficient, 0) /
            weight,
          coefficient: 1,
        });
      } else {
        items.push(...values);
      }
    }
    const weight = items.reduce((sum, item) => sum + item.coefficient, 0);
    const average =
      missing.length || !weight
        ? null
        : items.reduce((sum, item) => sum + item.note * item.coefficient, 0) / weight;
    return {
      matiereId: matiere.id,
      matiere: matiere.nom,
      coefficient: matiere.coefficient,
      notes: items.map((item) => ({ ...item, note: round(item.note) })),
      moyenneVingtieme: average === null ? null : round(average),
      pointsPonderes: average === null ? null : round(average * matiere.coefficient),
      appreciation: average === null ? 'Incomplet' : appreciation(average),
    };
  });
  const academicComplete = lines.length > 0 && notesManquantes.length === 0;
  if (!lines.length)
    notesManquantes.push({
      matiereId: '',
      matiere: 'Matières',
      evaluationsManquantes: ['Aucune matière définie.'],
    });
  if (input.conduite === null) {
    notesManquantes.push({
      matiereId: 'conduite',
      matiere: 'CONDUITE',
      evaluationsManquantes: ['Note de conduite non saisie.'],
    });
  } else {
    lines.push({
      matiereId: 'conduite',
      matiere: 'CONDUITE',
      coefficient: 1,
      notes: [],
      moyenneVingtieme: input.conduite,
      pointsPonderes: input.conduite,
      appreciation: appreciation(input.conduite),
    });
  }
  const totalPoints = round(
    lines.reduce((sum, line) => sum + (line.pointsPonderes ?? 0), 0),
  );
  const totalCoefficients = lines.reduce((sum, line) => sum + line.coefficient, 0);
  const status = !academicComplete
    ? 'incomplet'
    : input.conduite === null
      ? 'a_finaliser'
      : 'complet';
  return {
    status,
    moyennesParMatiere: lines,
    notesManquantes,
    resultatFinal:
      status === 'complet'
        ? {
            totalPoints,
            totalCoefficients,
            moyenneGenerale: round(totalPoints / totalCoefficients),
          }
        : null,
  };
}

// Les identifiants locaux et MongoDB n’imposent pas le même ordre de lecture.
// Seul le contenu des lignes compte pour vérifier si un calcul est encore valable.
function calculationSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(calculationSignature).sort());
  }
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, calculationSignature(entry)]),
    );
  }
  return JSON.stringify(value) ?? '';
}

export function checkBulletinCalculation<T extends Bulletin>(
  record: T,
  input: Omit<CalculationInput, 'config' | 'conduite'>,
): T {
  if (record.isDeleted || record.needsRecalculation) return record;
  if (!record.configCalcul || !record.calculatedAt)
    return { ...record, needsRecalculation: true };
  const expected = calculateBulletin({
    ...input,
    config: record.configCalcul,
    conduite: record.vieScolaire.conduite ?? null,
  });
  const changed =
    expected.status !== record.status ||
    calculationSignature(expected.moyennesParMatiere) !==
      calculationSignature(record.moyennesParMatiere) ||
    calculationSignature(expected.notesManquantes) !==
      calculationSignature(record.notesManquantes);
  return { ...record, needsRecalculation: changed };
}

export function deriveBulletinResults<T extends Bulletin>(
  records: T[],
  periods: {
    id: string;
    nom: string;
    ordre: number;
    coefficient: number;
    niveauScolaireId?: string;
    dateDebut?: string;
    dateFin?: string;
    isDeleted?: boolean;
  }[],
  inscriptions: {
    id: string;
    classeId: string;
    anneeScolaire: string;
    isDeleted: boolean;
  }[],
  classes: { id: string; niveauScolaireId: string }[],
  matchesYear: (
    period: { dateDebut?: string; dateFin?: string },
    year: string,
  ) => boolean,
): T[] {
  const valid = records.filter(
    (record) =>
      !record.isDeleted &&
      !record.needsRecalculation &&
      record.status === 'complet' &&
      record.resultatFinal,
  );
  return records.map((record) => {
    const inscription = inscriptions.find((item) => item.id === record.inscriptionId);
    const year = inscription?.anneeScolaire ?? record.anneeScolaire;
    const cohort = inscriptions.filter(
      (item) =>
        !item.isDeleted &&
        item.classeId === record.classeId &&
        item.anneeScolaire === year,
    );
    const peers = valid.filter(
      (item) =>
        item.classeId === record.classeId &&
        item.periodeId === record.periodeId &&
        cohort.some((entry) => entry.id === item.inscriptionId),
    );
    const result = record.resultatFinal
      ? {
          ...record.resultatFinal,
          rang: null as number | null,
          moyenneAnnuelle: null as number | null,
          moyennesPrecedentes: [] as {
            periodeId: string;
            nom: string;
            moyenne: number;
          }[],
        }
      : null;
    if (result && valid.includes(record) && inscription && !inscription.isDeleted) {
      result.rang =
        1 +
        peers.filter(
          (peer) => peer.resultatFinal!.moyenneGenerale > result.moyenneGenerale,
        ).length;
      const level = classes.find((item) => item.id === record.classeId)?.niveauScolaireId;
      const applicable = periods
        .filter(
          (period) =>
            !period.isDeleted &&
            (!period.niveauScolaireId || period.niveauScolaireId === level) &&
            year &&
            matchesYear(period, year),
        )
        .sort((a, b) => a.ordre - b.ordre);
      const current = applicable.find((period) => period.id === record.periodeId);
      const history = applicable.map((period) => ({
        period,
        bulletin: valid.find(
          (item) =>
            item.inscriptionId === record.inscriptionId && item.periodeId === period.id,
        ),
      }));
      result.moyennesPrecedentes = history
        .filter((item) => item.bulletin && current && item.period.ordre < current.ordre)
        .map((item) => ({
          periodeId: item.period.id,
          nom: item.period.nom,
          moyenne: item.bulletin!.resultatFinal!.moyenneGenerale,
        }));
      if (
        current &&
        current.ordre === applicable.at(-1)?.ordre &&
        history.every((item) => item.bulletin)
      ) {
        result.moyenneAnnuelle = round(
          history.reduce(
            (sum, item) =>
              sum +
              item.bulletin!.resultatFinal!.moyenneGenerale * item.period.coefficient,
            0,
          ) / applicable.reduce((sum, period) => sum + period.coefficient, 0),
        );
      }
    }
    return {
      ...record,
      anneeScolaire: year,
      infosDeClasse: { effectif: cohort.length },
      resultatFinal: result,
    };
  });
}
