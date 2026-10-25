import jwt from 'jsonwebtoken';
import { offlineSigningKey } from '../lib/offlineSigningKey';
import type { requireActiveUser } from './accessService';

export const offlineAccessService = {
  async issue(user: Awaited<ReturnType<typeof requireActiveUser>>) {
    const { privateKey, publicKey } = await offlineSigningKey();
    const grant = jwt.sign({ user }, privateKey, {
      algorithm: 'ES256',
      subject: user.id,
      issuer: 'cpeg-michel-lauret',
      audience: 'offline-access',
      expiresIn: '7d',
    });
    return { grant, publicKey };
  },
};
