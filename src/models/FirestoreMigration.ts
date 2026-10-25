import { Schema, model } from 'mongoose';

const archiveSchema = new Schema(
  {
    _id: { type: String, required: true },
    sourceHash: { type: String, required: true, index: true },
    sourcePath: { type: String, required: true },
    document: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'migrationFirestoreArchives', timestamps: true },
);
archiveSchema.index({ sourceHash: 1, sourcePath: 1 }, { unique: true });

const runSchema = new Schema(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true },
    databaseId: { type: String, required: true },
    schoolYear: { type: String, required: true },
    decisionsHash: { type: String, required: true },
    summary: { type: Schema.Types.Mixed, required: true },
    sourceToTarget: { type: Schema.Types.Mixed, required: true },
    pending: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['archiving', 'ready', 'complete'],
      required: true,
      default: 'archiving',
    },
    completedAt: Date,
  },
  { collection: 'migrationFirestoreRuns', timestamps: true },
);

export const FirestoreArchive = model('FirestoreArchive', archiveSchema);
export const FirestoreMigrationRun = model('FirestoreMigrationRun', runSchema);
