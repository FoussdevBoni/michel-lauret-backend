import { Schema, model, type Document, type Types } from 'mongoose';
export interface INote extends Document {
  inscriptionId: Types.ObjectId;
  matiereId: Types.ObjectId;
  periodeId: Types.ObjectId;
  evaluationId: Types.ObjectId;
  enseignantId: Types.ObjectId;
  classeId: Types.ObjectId;
  anneeScolaire: string;
  note: number;
  notePlafond: number;
  coefficient: number;
  closed: boolean;
  migrationSourceHash?: string;
  closedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}
const reference = (ref: string) => ({ type: Schema.Types.ObjectId, ref, required: true });
const schema = new Schema<INote>(
  {
    inscriptionId: reference('Inscription'),
    matiereId: reference('Matiere'),
    periodeId: reference('Periode'),
    evaluationId: reference('Evaluation'),
    enseignantId: reference('Enseignant'),
    classeId: reference('Classe'),
    anneeScolaire: { type: String, required: true },
    note: { type: Number, required: true, min: 0 },
    notePlafond: { type: Number, required: true, min: Number.MIN_VALUE },
    coefficient: { type: Number, required: true, min: Number.MIN_VALUE },
    closed: { type: Boolean, default: false },
    migrationSourceHash: { type: String, match: /^[a-f0-9]{64}$/ },
    closedAt: Date,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'notes' },
);
schema.index(
  { inscriptionId: 1, matiereId: 1, periodeId: 1, evaluationId: 1 },
  {
    name: 'unique_active_grade_per_assessment',
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);
schema.index({ classeId: 1, anneeScolaire: 1 });
schema.index({ enseignantId: 1 });
export const Note = model<INote>('Note', schema);
