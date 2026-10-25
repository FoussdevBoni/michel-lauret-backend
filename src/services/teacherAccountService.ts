import { z } from 'zod';
import User from '../models/User';
import { Enseignant } from '../models/Teacher';
import { withTransaction } from '../lib/withTransaction';
import { HttpError } from '../utils/HttpError';
const identifier = z.string().regex(/^[a-f0-9]{24}$/i);
const password = z.string().min(10, 'Utilisez au moins 10 caractères.').max(200);
const createSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254), password })
  .strict();
const updateSchema = z
  .object({ status: z.enum(['active', 'inactive']), password: password.optional() })
  .strict();
const publicAccount = (record: {
  _id: unknown;
  email?: string;
  status: string;
  username: string;
}) => ({
  id: String(record._id),
  email: record.email ?? '',
  status: record.status,
  username: record.username,
});
async function teacher(id: string, lock = false) {
  identifier.parse(id);
  const record = lock
    ? await Enseignant.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $inc: { referenceRevision: 1 } },
        { new: true },
      )
    : await Enseignant.findOne({ _id: id, isDeleted: false });
  if (!record) throw new HttpError(404, 'Dossier enseignant introuvable.');
  return record;
}
async function linkedAccount(userId?: string) {
  if (!userId) return null;
  if (!identifier.safeParse(userId).success)
    throw new HttpError(409, 'Le rattachement de ce compte doit être vérifié.');
  const record = await User.findOne({ _id: userId, role: 'teacher' });
  if (!record)
    throw new HttpError(409, 'Le rattachement de ce compte doit être vérifié.');
  return record;
}
export const teacherAccountService = {
  async get(id: string) {
    const record = await linkedAccount((await teacher(id)).userId);
    return record ? publicAccount(record) : null;
  },
  async create(id: string, input: unknown) {
    const data = createSchema.parse(input);
    return withTransaction(async () => {
      const record = await teacher(id, true);
      if (record.userId)
        throw new HttpError(409, 'Cet enseignant possède déjà un compte.');
      if (await User.exists({ email: data.email }))
        throw new HttpError(
          409,
          'Cette adresse possède déjà un compte. Faites vérifier son rattachement avant de continuer.',
        );
      const [account] = await User.create([
        {
          email: data.email,
          password: data.password,
          username: `${record.prenom} ${record.nom}`,
          role: 'teacher',
          status: 'active',
          isVerified: true,
          provider: 'password',
        },
      ]);
      record.userId = String(account._id);
      await record.save();
      return publicAccount(account);
    });
  },
  async update(id: string, input: unknown) {
    const data = updateSchema.parse(input);
    return withTransaction(async () => {
      const account = await linkedAccount((await teacher(id, true)).userId);
      if (!account)
        throw new HttpError(404, 'Préparez d’abord le compte de cet enseignant.');
      if (
        (await Enseignant.countDocuments({
          userId: String(account._id),
          isDeleted: false,
        })) !== 1
      )
        throw new HttpError(
          409,
          'Ce compte est rattaché à plusieurs dossiers. Contactez le responsable de la configuration.',
        );
      account.status = data.status;
      if (data.password) {
        account.password = data.password;
        account.provider = 'password';
      }
      await account.save();
      return publicAccount(account);
    });
  },
};
