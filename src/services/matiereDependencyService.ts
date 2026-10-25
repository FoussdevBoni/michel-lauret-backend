import mongoose, { type ClientSession, type Types } from 'mongoose';
export async function hasMatiereDependencies(id: Types.ObjectId, session: ClientSession) {
  const db = mongoose.connection.db!;
  for (const collection of ['notes', 'seances', 'evaluations']) {
    if (
      await db
        .collection(collection)
        .findOne(
          { matiereId: id, isDeleted: { $ne: true } },
          { session, projection: { _id: 1 } },
        )
    )
      return true;
  }
  if (
    await db
      .collection('bulletins')
      .findOne(
        { 'moyennesParMatiere.matiereId': id, isDeleted: { $ne: true } },
        { session, projection: { _id: 1 } },
      )
  )
    return true;
  return Boolean(
    await db.collection('enseignants').findOne(
      {
        'enseignements.matiereId': { $in: [id, String(id)] },
        isDeleted: { $ne: true },
      },
      { session, projection: { _id: 1 } },
    ),
  );
}
