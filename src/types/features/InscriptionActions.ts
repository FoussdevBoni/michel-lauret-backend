import { z } from 'zod';
import { inscriptionInputSchema } from './Inscription';
import { studentInputSchema } from './Student';

export const inscriptionIdsSchema = z
  .array(z.string().regex(/^[a-f0-9]{24}$/i))
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]);
export const reenrolmentSchema = inscriptionInputSchema
  .omit({ eleveDataId: true, isActive: true })
  .extend({ eleveDataIds: inscriptionIdsSchema });
export const transferSchema = z.object({
  ids: inscriptionIdsSchema,
  classeId: inscriptionInputSchema.shape.classeId,
  dateInscription: inscriptionInputSchema.shape.dateInscription,
});
export const newStudentInscriptionSchema = z.object({
  student: studentInputSchema,
  inscription: inscriptionInputSchema.omit({ eleveDataId: true }),
});
export type ReenrolmentInput = z.infer<typeof reenrolmentSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type NewStudentInscriptionInput = z.infer<typeof newStudentInscriptionSchema>;
