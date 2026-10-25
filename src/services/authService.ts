import jwt from 'jsonwebtoken';
import { z } from 'zod';
import User from '../models/User';
import { requireActiveUser } from './accessService';
import { HttpError } from '../utils/HttpError';
import { authenticatePassword } from './passwordAuthenticationService';

export const authService = {
  async login(input: unknown) {
    const data = z
      .object({
        email: z.string().trim().toLowerCase().email().max(254),
        password: z
          .string()
          .min(1)
          .max(4096)
          .refine(
            (value) => Buffer.byteLength(value, 'utf8') <= 4096,
            'Mot de passe trop long.',
          ),
      })
      .strict()
      .parse(input);
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32)
      throw new HttpError(503, 'La connexion doit être configurée sur le serveur.');
    const record = await User.findOne({ email: data.email }).select(
      '+password +legacyPassword',
    );
    if (
      !record ||
      !(await authenticatePassword(record, data.password)) ||
      record.status !== 'active' ||
      !record.isVerified
    )
      throw new HttpError(
        401,
        'Email ou mot de passe incorrect, ou compte indisponible.',
      );
    const token = jwt.sign({ id: String(record._id) }, secret, {
      algorithm: 'HS256',
      expiresIn: '30m',
    });
    const user = await requireActiveUser(token);
    return { token, user };
  },
};
