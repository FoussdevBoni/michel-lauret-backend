import { z } from 'zod';

const evaluationRule = z
  .object({
    actif: z.boolean(),
    mode: z.enum(['moyenne', 'conserver']),
  })
  .strict();
export const bulletinConfigSchema = z
  .object({
    interrogation: evaluationRule,
    devoir: evaluationRule,
    composition: evaluationRule,
  })
  .strict()
  .refine(
    (config) => Object.values(config).some((rule) => rule.actif),
    'Activez au moins un type d’évaluation.',
  );
export type BulletinConfig = z.infer<typeof bulletinConfigSchema>;
export const defaultBulletinConfig: BulletinConfig = {
  interrogation: { actif: true, mode: 'moyenne' },
  devoir: { actif: true, mode: 'conserver' },
  composition: { actif: true, mode: 'conserver' },
};
export const bulletinIdentitySchema = z
  .object({
    inscriptionId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase()),
    periodeId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase()),
  })
  .strict();
export const bulletinChangesSchema = z
  .object({
    version: z.number().int().nonnegative().optional(),
    vieScolaire: z
      .object({
        absences: z.number().int().nonnegative().optional(),
        retards: z.number().int().nonnegative().optional(),
        conduite: z.number().finite().min(0).max(20).nullable().optional(),
      })
      .strict()
      .optional(),
    commentaires: z
      .object({
        decisionConseil: z.string().trim().max(1000).optional(),
        observations: z.string().trim().max(3000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export interface BulletinLine {
  matiereId: string;
  matiere: string;
  coefficient: number;
  notes: { evaluationId: string; nom: string; note: number; coefficient: number }[];
  moyenneVingtieme: number | null;
  pointsPonderes: number | null;
  appreciation: string;
}
export interface BulletinResult {
  totalPoints: number;
  totalCoefficients: number;
  moyenneGenerale: number;
  rang?: number | null;
  moyennesPrecedentes?: { periodeId: string; nom: string; moyenne: number }[];
  moyenneAnnuelle?: number | null;
}
export interface Bulletin {
  id: string;
  inscriptionId: string;
  periodeId: string;
  classeId: string;
  anneeScolaire?: string;
  version: number;
  localRevision?: number;
  isDeleted?: boolean;
  deletedAt?: string;
  status: string;
  needsRecalculation?: boolean;
  vieScolaire: { absences: number; retards: number; conduite: number | null };
  commentaires: { decisionConseil: string; observations: string };
  moyennesParMatiere: BulletinLine[];
  resultatFinal: BulletinResult | null;
  infosDeClasse: { effectif: number };
  notesManquantes: {
    matiereId: string;
    matiere: string;
    evaluationsManquantes: string[];
  }[];
  configCalcul?: BulletinConfig;
  calculatedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface BulletinWithDetails extends Bulletin {
  eleve: string;
  matricule: string;
  classe: string;
  periode: string;
}
