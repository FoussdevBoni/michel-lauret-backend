import { z } from 'zod';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Date invalide.');
const fields = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
    ordre: z.number().int().min(1).max(20),
    coefficient: z.number().finite().positive().max(10),
    niveauScolaireId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase())
      .optional(),
    dateDebut: dateSchema.optional(),
    dateFin: dateSchema.optional(),
  })
  .strict();
function datesValid(data: { dateDebut?: string; dateFin?: string }) {
  return (
    (!data.dateDebut && !data.dateFin) ||
    Boolean(data.dateDebut && data.dateFin && data.dateDebut < data.dateFin)
  );
}
export const periodeInputSchema = fields.refine(
  datesValid,
  'Renseignez les deux dates, avec un début antérieur à la fin.',
);
export const periodeUpdateSchema = fields
  .extend({ version: z.number().int().nonnegative() })
  .refine(datesValid, 'Renseignez les deux dates, avec un début antérieur à la fin.');
export const schoolYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, 'Utilisez le format 2026-2027.')
  .refine(
    (value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1,
    'Année scolaire invalide.',
  );
export type PeriodeInput = z.infer<typeof periodeInputSchema>;
export interface Periode extends PeriodeInput {
  id: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface PeriodeWithNiveau extends Periode {
  niveauScolaire: string;
}
export interface PeriodeFilters {
  niveauScolaireId?: string;
  anneeScolaire?: string;
}
export function matchesSchoolYear(
  periode: { dateDebut?: string; dateFin?: string },
  year: string,
) {
  if (!periode.dateDebut && !periode.dateFin) return true;
  return Boolean(
    periode.dateDebut &&
      periode.dateFin &&
      periode.dateDebut <= year.slice(5) + '-12-31' &&
      periode.dateFin >= year.slice(0, 4) + '-01-01',
  );
}
