import { z } from 'zod';

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(4096),
    newPassword: z.string().min(10, 'Utilisez au moins 10 caractères.').max(200),
  })
  .strict()
  .refine((input) => input.currentPassword !== input.newPassword, {
    message: 'Choisissez un mot de passe différent de l’actuel.',
    path: ['newPassword'],
  });
