import jwt from 'jsonwebtoken';
import User from '../models/User';
import { HttpError } from '../utils/HttpError';

export async function requireActiveUser(token: string) {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new HttpError(503, "L'authentification sécurisée doit être configurée.");
  }

  let payload;

  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session invalide ou expirée.');
  }

  if (
    typeof payload === 'string' ||
    typeof payload.id !== 'string' ||
    !/^[a-f0-9]{24}$/i.test(payload.id)
  ) {
    throw new HttpError(401, 'Session invalide.');
  }

  const user = await User.findById(payload.id).select(
    'role status isVerified username email',
  );

  if (
    !user ||
    user.status !== 'active' ||
    !user.isVerified ||
    !['admin', 'teacher', 'student'].includes(user.role)
  ) {
    throw new HttpError(401, 'Compte indisponible.');
  }

  return {
    id: String(user._id),
    username: user.username,
    email: user.email ?? '',
    role: user.role,
  };
}

export async function requireActiveAdministrator(token: string) {
  const user = await requireActiveUser(token);
  if (user.role !== 'admin')
    throw new HttpError(403, 'Accès réservé à un administrateur.');
  return user;
}
