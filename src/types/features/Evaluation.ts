import { z } from 'zod';
export const evaluationTypes = ['composition', 'devoir', 'interrogation'] as const;
export const evaluationInputSchema = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(100),
    abreviation: z.string().trim().toUpperCase().max(20).default(''),
    type: z.enum(evaluationTypes),
    obligatoire: z.boolean().optional(),
    coefficient: z
      .number()
      .finite()
      .positive('Le coefficient doit être supérieur à zéro.')
      .max(10),
    periodeId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i, 'Identifiant invalide.')
      .transform((value) => value.toLowerCase())
      .optional(),
    niveauScolaireId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i, 'Identifiant invalide.')
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .strict();
export const evaluationUpdateSchema = evaluationInputSchema.extend({
  version: z.number().int().nonnegative(),
});
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;
export interface Evaluation extends EvaluationInput {
  id: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface EvaluationWithParents extends Evaluation {
  periode: string;
  niveauScolaire: string;
}
export interface EvaluationFilters {
  periodeId?: string;
  niveauScolaireId?: string;
  matiereId?: string;
  type?: EvaluationInput['type'];
  recherche?: string;
}
export function evaluationAppliesTo(
  evaluation: { periodeId?: string | null; niveauScolaireId?: string | null },
  periodeId: string,
  niveauScolaireId: string,
) {
  return (
    (!evaluation.periodeId || evaluation.periodeId === periodeId) &&
    (!evaluation.niveauScolaireId || evaluation.niveauScolaireId === niveauScolaireId)
  );
}
export function normalizeEvaluationName(value: string) {
  return value.trim().toLowerCase();
}
