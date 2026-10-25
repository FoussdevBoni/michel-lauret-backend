import { z } from 'zod';
import { noteInputSchema } from './Note';
import { schoolYearSchema } from './Periode';

export const teacherGradeDataSchema = noteInputSchema
  .omit({ notePlafond: true, coefficient: true })
  .extend({
    classeId: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .transform((value) => value.toLowerCase()),
    anneeScolaire: schoolYearSchema,
    expectedNotePlafond: z.number().finite().positive(),
    expectedCoefficient: z.number().finite().positive(),
  });

export const teacherNoteRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            localId: z.string().min(1).max(150),
            targetId: z
              .string()
              .regex(/^[a-f0-9]{24}$/i)
              .optional(),
            version: z.number().int().nonnegative(),
            action: z.enum(['save', 'delete']),
            data: teacherGradeDataSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
