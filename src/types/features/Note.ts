import { z } from 'zod';
const identifier = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Identifiant invalide.')
  .transform((value) => value.toLowerCase());
const positive = z.number().finite().positive();
export const noteInputSchema = z
  .object({
    inscriptionId: identifier,
    matiereId: identifier,
    periodeId: identifier,
    evaluationId: identifier,
    note: z.number().finite().nonnegative(),
    notePlafond: positive.optional(),
    coefficient: positive.optional(),
  })
  .strict();
export const noteUpdateSchema = z
  .object({
    version: z.number().int().nonnegative(),
    note: z.number().finite().nonnegative(),
    notePlafond: positive.optional(),
    coefficient: positive.optional(),
  })
  .strict();
export const noteCloseSchema = z
  .object({ version: z.number().int().nonnegative() })
  .strict();
export const noteImportSchema = z
  .object({
    classeId: identifier,
    anneeScolaire: z
      .string()
      .regex(/^\d{4}-\d{4}$/)
      .refine(
        (value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1,
        'Année scolaire invalide.',
      ),
    matiereId: identifier,
    periodeId: identifier,
    evaluationId: identifier,
    notePlafond: positive.optional(),
    notes: z.array(z.unknown()).min(1).max(100),
  })
  .strict();
export const noteImportRowSchema = z
  .object({
    matricule: z.string().trim().toUpperCase().min(1, 'Matricule obligatoire.').max(64),
    note: z.number().finite().nonnegative(),
  })
  .strict();
export type NoteInput = z.infer<typeof noteInputSchema>;
export type NoteUpdate = z.infer<typeof noteUpdateSchema>;
export type NoteImport = z.infer<typeof noteImportSchema>;
export type NoteImportRow = z.infer<typeof noteImportRowSchema>;
export interface Note extends Omit<NoteInput, 'notePlafond' | 'coefficient'> {
  id: string;
  notePlafond: number;
  coefficient: number;
  enseignantId: string;
  classeId: string;
  anneeScolaire: string;
  closed: boolean;
  closedAt?: string;
  isDeleted: boolean;
  deletedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface NoteWithDetails extends Note {
  eleve: string;
  matricule: string;
  matiere: string;
  periode: string;
  evaluation: string;
  classe: string;
  enseignant: string;
}
export interface NoteFilters {
  inscriptionId?: string;
  matiereId?: string;
  periodeId?: string;
  evaluationId?: string;
  classeId?: string;
  eleveDataId?: string;
  anneeScolaire?: string;
  closed?: boolean;
  recherche?: string;
}
export interface NoteCloseItem {
  id: string;
  version: number;
}
export interface NoteWorkbookSheet {
  name: string;
  rows: (string | number | null)[][];
}
