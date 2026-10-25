import User from '../models/User';
import { withTransaction } from '../lib/withTransaction';
import { HttpError } from '../utils/HttpError';
import { authenticatePassword } from './passwordAuthenticationService';
import { changePasswordSchema } from '../types/features/Account';

export const accountService = {
  async changePassword(ownerId: string, input: unknown) {
    const data = changePasswordSchema.parse(input);
    return withTransaction(async () => {
      const account = await User.findById(ownerId).select('+password +legacyPassword');
      if (!account || !(await authenticatePassword(account, data.currentPassword))) {
        throw new HttpError(400, 'Le mot de passe actuel est incorrect.');
      }
      // Relecture : la vérification d'une empreinte historique peut l'avoir convertie.
      const current = await User.findById(ownerId);
      if (!current || current.status !== 'active')
        throw new HttpError(401, 'Compte indisponible.');
      current.password = data.newPassword;
      await current.save();
      return { message: 'Votre mot de passe a été modifié.' };
    });
  },
};
