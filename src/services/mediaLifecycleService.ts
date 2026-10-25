import type { ClientSession } from 'mongoose';
import { MediaSlot, MediaCleanup } from '../models/Media';

export async function retireMediaForParent(
  entity: 'school' | 'student',
  targetId: string,
  session: ClientSession,
) {
  const slots = await MediaSlot.find({ entity, targetId }).session(session);
  for (const slot of slots) {
    if (slot.objectKey)
      await MediaCleanup.updateOne(
        { objectKey: slot.objectKey },
        { $setOnInsert: { nextAttemptAt: new Date() } },
        { session, upsert: true },
      );
    slot.objectKey = null;
    slot.mime = null;
    slot.revision++;
    await slot.save({ session });
  }
}
