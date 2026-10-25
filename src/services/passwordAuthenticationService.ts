import bcrypt from 'bcryptjs';
import User, { type IUser } from '../models/User';
import { passwordDigest, verifyConfiguredLegacyPassword } from '../lib/legacyPassword';

export async function authenticatePassword(record: IUser, password: string) {
  if (record.status !== 'active' || !record.isVerified || record.provider !== 'password')
    return false;
  if (record.password) return record.comparePassword(password);
  if (!record.legacyPassword) return false;
  const previous = {
    hash: record.legacyPassword.hash,
    salt: record.legacyPassword.salt,
    configId: record.legacyPassword.configId,
  };
  if (!(await verifyConfiguredLegacyPassword(password, previous))) return false;

  const hash = await bcrypt.hash(passwordDigest(password), 10);
  // Une réinitialisation ou une suspension concurrente doit l'emporter sur la conversion.
  const result = await User.updateOne(
    {
      _id: record._id,
      status: 'active',
      isVerified: true,
      provider: 'password',
      password: { $exists: false },
      'legacyPassword.hash': previous.hash,
      'legacyPassword.salt': previous.salt,
      'legacyPassword.configId': previous.configId,
    },
    {
      $set: { password: hash, passwordFormat: 'bcrypt-sha256', lastLogin: new Date() },
      $unset: { legacyPassword: '' },
    },
  );
  if (result.modifiedCount === 1) return true;

  // Deux connexions simultanées peuvent convertir le même compte : revérifier le gagnant.
  const current = await User.findById(record._id).select('+password');
  return Boolean(
    current &&
      current.status === 'active' &&
      current.isVerified &&
      current.provider === 'password' &&
      (await current.comparePassword(password)),
  );
}
