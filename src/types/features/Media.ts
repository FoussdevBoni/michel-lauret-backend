import { z } from 'zod';
export const mediaTargetSchema = z
  .object({
    entity: z.enum(['school', 'student']),
    targetId: z.string(),
    kind: z.enum(['logo', 'enTeteCarte', 'photo']),
  })
  .strict()
  .refine(
    (value) =>
      value.entity === 'school'
        ? value.targetId === 'school' && value.kind !== 'photo'
        : /^[a-f0-9]{24}$/i.test(value.targetId) && value.kind === 'photo',
    'Cible de l’image invalide.',
  );
export const mediaMutationSchema = z
  .object({ operationId: z.string().uuid(), revision: z.number().int().nonnegative() })
  .strict();
export type MediaTarget = z.infer<typeof mediaTargetSchema>;
export function mediaKey(target: MediaTarget) {
  return `${target.entity}:${target.targetId}:${target.kind}`;
}
