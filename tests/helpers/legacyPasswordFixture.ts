// Vecteur public indépendant publié par Firebase, pas un compte réel.
// https://github.com/firebase/scrypt#password-hashing
import { legacyConfigId } from '../../src/lib/legacyPassword';
import type {
  AuthExport,
  LegacyHashConfig,
} from '../../src/types/features/LegacyPassword';

export const legacyConfig: LegacyHashConfig = {
  algorithm: 'SCRYPT',
  signerKey:
    'jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==',
  saltSeparator: 'Bw==',
  rounds: 8,
  memoryCost: 14,
};
export const legacyCredential = {
  hash: 'lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==',
  salt: '42xEC+ixf3L2lw==',
  configId: legacyConfigId(legacyConfig),
};
export function authBundle(): AuthExport {
  return {
    format: 'cpeg-auth-export',
    version: 1,
    projectId: 'test-school',
    exportedAt: new Date().toISOString(),
    configId: legacyCredential.configId,
    users: [
      {
        uid: 'old-teacher',
        email: 'teacher@example.test',
        disabled: false,
        emailVerified: false,
        providers: ['password'],
        passwordHash: legacyCredential.hash,
        passwordSalt: legacyCredential.salt,
        hasMfa: false,
      },
    ],
  };
}
