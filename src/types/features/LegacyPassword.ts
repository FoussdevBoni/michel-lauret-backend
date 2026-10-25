import { z } from 'zod';

export const base64Value = z
  .string()
  .max(4096)
  .refine(
    (value) =>
      /^[A-Za-z0-9+/_-]*={0,2}$/.test(value) &&
      Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') ===
        value.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, ''),
    'Encodage de migration invalide.',
  )
  .transform((value) => Buffer.from(value, 'base64').toString('base64'));

export const legacyHashConfigSchema = z
  .object({
    algorithm: z.literal('SCRYPT'),
    signerKey: base64Value.refine((value) => Buffer.from(value, 'base64').length >= 32),
    saltSeparator: base64Value,
    rounds: z.number().int().min(1).max(16),
    memoryCost: z.number().int().min(1).max(16),
  })
  .strict()
  .refine(
    (value) => 128 * value.rounds * 2 ** value.memoryCost <= 128 * 1024 * 1024,
    'Paramètres de migration trop coûteux.',
  );

export type LegacyHashConfig = z.infer<typeof legacyHashConfigSchema>;

export const legacyPasswordSchema = z
  .object({
    hash: base64Value.refine((value) => value.length > 0),
    salt: base64Value.refine((value) => value.length > 0),
    configId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type LegacyPassword = z.infer<typeof legacyPasswordSchema>;

export const authExportSchema = z
  .object({
    format: z.literal('cpeg-auth-export'),
    version: z.literal(1),
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
    exportedAt: z.string().datetime(),
    configId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    users: z
      .array(
        z
          .object({
            uid: z.string().min(1).max(128),
            email: z.string().max(254).optional(),
            disabled: z.boolean(),
            emailVerified: z.boolean(),
            passwordHash: z.string().max(4096).optional(),
            passwordSalt: z.string().max(4096).optional(),
            providers: z.array(z.string().max(100)).max(20),
            hasMfa: z.boolean(),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();

export type AuthExport = z.infer<typeof authExportSchema>;
