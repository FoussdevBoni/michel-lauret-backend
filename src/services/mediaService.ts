import { withTransaction } from '../lib/withTransaction';
import { type ClientSession } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MediaSlot, MediaOperation, MediaCleanup } from '../models/Media';
import { Student } from '../models/Student';
import { Etablissement } from '../models/Etablissement';
import {
  mediaTargetSchema,
  mediaMutationSchema,
  mediaKey,
  type MediaTarget,
} from '../types/features/Media';
import { schoolImageSchema, etablissementFields } from '../types/features/Etablissement';
import { studentInputSchema } from '../types/features/Student';
import { uploadService } from './uploadService';
import { studentService } from './studentService';
import { etablissementService } from './etablissementService';
import { HttpError } from '../utils/HttpError';
import { runBatch } from '../utils/runBatch';

async function requireParent(target: MediaTarget, session?: ClientSession) {
  const query =
    target.entity === 'student'
      ? Student.findOne({ _id: target.targetId, isDeleted: false })
      : Etablissement.findOne({ key: 'school', isDeleted: false });
  const parent = await query.session(session ?? null);
  if (!parent)
    throw new HttpError(404, 'Le dossier associé à cette image est absent ou archivé.');
}
async function lockParent(target: MediaTarget, session: ClientSession) {
  const changed =
    target.entity === 'student'
      ? await Student.updateOne(
          { _id: target.targetId, isDeleted: false },
          { $inc: { inscriptionRevision: 1 } },
          { session },
        )
      : await Etablissement.updateOne(
          { key: 'school', isDeleted: false },
          { $inc: { mediaLockRevision: 1 } },
          { session },
        );
  if (changed.matchedCount !== 1) throw new HttpError(404, 'Dossier indisponible.');
}
function validateFile(file: Express.Multer.File) {
  const mime = file.mimetype;
  const image = `data:${mime};base64,${file.buffer.toString('base64')}`;
  schoolImageSchema.parse(image);
  return {
    mime,
    bytes: file.buffer,
    sha: createHash('sha256').update(file.buffer).digest('hex'),
    extension: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1],
  };
}
export const mediaService = {
  async registerParent(input: unknown) {
    const data = z
      .object({
        entity: z.enum(['school', 'student']),
        data: z.unknown(),
        lookupOnly: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    if (data.entity === 'school') {
      const school = etablissementFields.parse(data.data);
      if (!(await etablissementService.get())) {
        if (data.lookupOnly)
          throw new HttpError(404, 'Aucune fiche d’établissement dans le cloud.');
        const state = await etablissementService.getState();
        if (state.version !== 0)
          throw new HttpError(
            409,
            'La fiche cloud est supprimée. Rétablissez-la explicitement avant un envoi.',
          );
        try {
          await etablissementService.save({
            ...school,
            logo: null,
            enTeteCarte: null,
            version: 0,
          });
        } catch (error) {
          if (!(await etablissementService.get())) throw error;
        }
      }
      return { targetId: 'school' };
    }
    const student = studentInputSchema.parse(data.data);
    if (!student.matricule)
      throw new HttpError(400, 'Le matricule est obligatoire pour relier la photo.');
    let existing = await Student.findOne({ matricule: student.matricule });
    if (!existing) {
      if (data.lookupOnly)
        throw new HttpError(
          404,
          'Ce dossier élève n’est pas encore présent dans le cloud.',
        );
      try {
        await studentService.create(student);
      } catch (error) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 11000
          )
        )
          throw error;
      }
      existing = await Student.findOne({ matricule: student.matricule });
    }
    const sameText = (a: string, b: string) =>
      a.trim().normalize('NFC').toLocaleLowerCase('fr') ===
      b.trim().normalize('NFC').toLocaleLowerCase('fr');
    if (
      !existing ||
      existing.isDeleted ||
      !sameText(existing.nom, student.nom) ||
      !sameText(existing.prenom, student.prenom) ||
      (existing.dateNaissance?.toISOString().slice(0, 10) ?? '') !==
        student.dateNaissance ||
      existing.sexe !== student.sexe
    )
      throw new HttpError(
        409,
        'Le matricule cloud correspond à un dossier différent ou archivé. Vérifiez l’identité de l’élève.',
      );
    return { targetId: String(existing._id) };
  },
  async get(input: unknown) {
    const target = mediaTargetSchema.parse(input);
    await requireParent(target);
    const slot = await MediaSlot.findOne({ key: mediaKey(target) });
    const bytes = slot?.objectKey ? await uploadService.download(slot.objectKey) : null;
    return {
      revision: slot?.revision ?? 0,
      image: bytes ? `data:${slot!.mime};base64,${bytes.toString('base64')}` : null,
    };
  },
  async mutate(
    targetInput: unknown,
    input: unknown,
    ownerId: string,
    file?: Express.Multer.File,
  ) {
    const target = mediaTargetSchema.parse(targetInput);
    const data = mediaMutationSchema.parse(input);
    const key = mediaKey(target);
    const image = file ? validateFile(file) : null;
    const digest = createHash('sha256')
      .update(JSON.stringify({ key, revision: data.revision, sha: image?.sha ?? null }))
      .digest('hex');
    const objectKey = image
      ? `${target.entity}/${target.targetId}/${target.kind}/${data.operationId}.${image.extension}`
      : undefined;
    await requireParent(target);
    let operation = await MediaOperation.findOne({ operationId: data.operationId });
    if (!operation) {
      try {
        operation = await MediaOperation.findOneAndUpdate(
          { operationId: data.operationId },
          { $setOnInsert: { key, digest, ownerId, objectKey, state: 'pending' } },
          { upsert: true, new: true },
        );
      } catch (error) {
        if (
          !(
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 11000
          )
        )
          throw error;
        operation = await MediaOperation.findOne({ operationId: data.operationId });
        if (!operation) throw error;
      }
    }
    if (operation!.digest !== digest || operation!.ownerId !== ownerId)
      throw new HttpError(
        409,
        'Cet identifiant d’envoi est déjà associé à une autre opération.',
      );
    if (operation!.state === 'committed')
      return { operationId: data.operationId, revision: operation!.revision! };
    if (operation!.state === 'conflict')
      throw new HttpError(
        409,
        'L’image cloud a changé. Rechargez-la avant de décider de la remplacer.',
      );
    const lease = randomUUID();
    const claimed = await MediaOperation.findOneAndUpdate(
      {
        _id: operation!._id,
        state: 'pending',
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date() } }],
      },
      { $set: { lease, leaseUntil: new Date(Date.now() + 90000) } },
    );
    if (!claimed)
      throw new HttpError(423, 'Cet envoi est déjà en cours. Réessayez dans un instant.');
    try {
      const current = await MediaSlot.findOne({ key });
      if ((current?.revision ?? 0) !== data.revision)
        throw new HttpError(
          409,
          'L’image cloud a changé. Rechargez-la avant de décider de la remplacer.',
        );
      if (image && objectKey)
        await uploadService.put(objectKey, image.bytes, image.mime, image.sha);
      await withTransaction(async (session) => {
        await lockParent(target, session);
        const previous = await MediaSlot.findOne({ key }).session(session);
        if ((previous?.revision ?? 0) !== data.revision)
          throw new HttpError(409, 'L’image cloud a changé.');
        const oldKey = previous?.objectKey;
        await MediaSlot.findOneAndUpdate(
          { key },
          {
            $set: {
              ...target,
              revision: data.revision + 1,
              objectKey: objectKey ?? null,
              mime: image?.mime ?? null,
            },
          },
          { session, upsert: true },
        );
        if (target.entity === 'student')
          await Student.updateOne(
            { _id: target.targetId },
            { $set: { photo: objectKey ? `media:${key}` : '' } },
            { session },
          );
        else
          await Etablissement.updateOne(
            { key: 'school' },
            { $set: { [target.kind]: null } },
            { session },
          );
        const committed = await MediaOperation.updateOne(
          { _id: operation!._id, lease, state: 'pending' },
          {
            $set: { state: 'committed', revision: data.revision + 1 },
            $unset: { lease: '', leaseUntil: '' },
          },
          { session },
        );
        if (committed.modifiedCount !== 1)
          throw new HttpError(423, 'Cet envoi a été repris. Réessayez.');
        if (oldKey && oldKey !== objectKey)
          await MediaCleanup.updateOne(
            { objectKey: oldKey },
            { $setOnInsert: { nextAttemptAt: new Date() } },
            { session, upsert: true },
          );
      });
      return { operationId: data.operationId, revision: data.revision + 1 };
    } catch (error) {
      if (error instanceof HttpError && [404, 409].includes(error.status)) {
        await MediaOperation.updateOne(
          { _id: operation!._id, lease, state: 'pending' },
          { $set: { state: 'conflict' } },
        );
        if (objectKey)
          await MediaCleanup.updateOne(
            { objectKey },
            { $setOnInsert: { nextAttemptAt: new Date() } },
            { upsert: true },
          );
      }
      throw error;
    } finally {
      await MediaOperation.updateOne(
        { _id: operation!._id, lease },
        { $unset: { lease: '', leaseUntil: '' } },
      );
    }
  },
  deleteMany: (items: unknown, ownerId: string) =>
    runBatch(items, async (item) => {
      const data = z
        .object({
          target: mediaTargetSchema,
          operationId: z.string().uuid(),
          revision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(item);
      return mediaService.mutate(
        data.target,
        { operationId: data.operationId, revision: data.revision },
        ownerId,
      );
    }),
  async uploadMany(input: unknown, files: Express.Multer.File[], ownerId: string) {
    let items: unknown;
    try {
      items = typeof input === 'string' ? JSON.parse(input) : input;
    } catch {
      throw new HttpError(400, 'Description du lot invalide.');
    }
    const list = z.array(z.unknown()).min(1).max(100).parse(items);
    if (files.length !== list.length)
      throw new HttpError(400, 'Chaque image doit correspondre à une opération du lot.');
    return runBatch(list, async (item: unknown) => {
      const parsed = z
        .object({
          target: mediaTargetSchema,
          operationId: z.string().uuid(),
          revision: z.number().int().nonnegative(),
          fileIndex: z
            .number()
            .int()
            .min(0)
            .max(files.length - 1),
        })
        .strict()
        .parse(item);
      return mediaService.mutate(
        parsed.target,
        { operationId: parsed.operationId, revision: parsed.revision },
        ownerId,
        files[parsed.fileIndex],
      );
    });
  },
  async cleanup() {
    // Un objet envoyé avant un arrêt du serveur peut ne pas avoir été rattaché.
    // Le bail exclut une reprise simultanée ; l'opération reste réessayable.
    const stale = await MediaOperation.find({
      state: 'pending',
      objectKey: { $exists: true },
      updatedAt: { $lt: new Date(Date.now() - 86400000) },
    }).limit(10);
    for (const item of stale) {
      const lease = randomUUID();
      const claimed = await MediaOperation.findOneAndUpdate(
        {
          _id: item._id,
          state: 'pending',
          $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date() } }],
        },
        { $set: { lease, leaseUntil: new Date(Date.now() + 60000) } },
      );
      if (!claimed) continue;
      try {
        if (item.objectKey && !(await MediaSlot.exists({ objectKey: item.objectKey })))
          await uploadService.delete(item.objectKey);
      } catch {
        /* Le prochain passage reprendra le nettoyage. */
      } finally {
        await MediaOperation.updateOne(
          { _id: item._id, lease },
          { $unset: { lease: '', leaseUntil: '' } },
        );
      }
    }
    const jobs = await MediaCleanup.find({ nextAttemptAt: { $lte: new Date() } }).limit(
      30,
    );
    let deletedCount = 0;
    for (const job of jobs) {
      if (await MediaSlot.exists({ objectKey: job.objectKey })) continue;
      try {
        await uploadService.delete(job.objectKey);
        await job.deleteOne();
        deletedCount++;
      } catch {
        job.attempts++;
        job.nextAttemptAt = new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7)),
        );
        await job.save();
      }
    }
    return { deletedCount, remaining: await MediaCleanup.countDocuments() };
  },
};
