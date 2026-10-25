import { Schema, model, type Document } from 'mongoose';
export interface IEnseignant extends Document {
  nom: string;
  prenom: string;
  email: string;
  tel: string;
  userId?: string;
  enseignements: { classeId: string; matiereId: string }[];
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
  referenceRevision: number;
}
const assignment = new Schema(
  {
    classeId: { type: String, required: true },
    matiereId: { type: String, required: true },
  },
  { _id: false },
);
const schema = new Schema<IEnseignant>(
  {
    nom: { type: String, required: true, trim: true, maxlength: 100 },
    prenom: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, default: '' },
    tel: { type: String, trim: true, default: '' },
    userId: { type: String, ref: 'User' },
    enseignements: { type: [assignment], default: [] },
    referenceRevision: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'enseignants' },
);
schema.index(
  { email: 1 },
  {
    name: 'unique_teacher_nonempty_email',
    unique: true,
    partialFilterExpression: { email: { $gt: '' } },
  },
);
schema.index({ 'enseignements.classeId': 1 });
schema.index({ 'enseignements.matiereId': 1 });
export const Enseignant = model<IEnseignant>('Enseignant', schema);
