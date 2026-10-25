import { Schema, model, type Document } from 'mongoose';
import type { EtablissementInput } from '../types/features/Etablissement';

export interface IEtablissement extends Document, EtablissementInput {
  mediaLockRevision: number;
  key: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
}
const optionalText = { type: String, default: '' };
const schema = new Schema<IEtablissement>(
  {
    mediaLockRevision: { type: Number, default: 0 },
    key: { type: String, required: true, enum: ['school'], unique: true },
    nom: { type: String, required: true, trim: true },
    adresse: { type: String, required: true, trim: true },
    telephone: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    anneeScolaire: { type: String, required: true },
    siteWeb: optionalText,
    pays: optionalText,
    tutelle: optionalText,
    directionDepartementale: optionalText,
    servicePedagogique: optionalText,
    devise: optionalText,
    codeEtablissement: optionalText,
    autorisation: optionalText,
    nomDirecteur: optionalText,
    fonctionSignataire: optionalText,
    mentionPiedPage: optionalText,
    logo: { type: String, default: null },
    enTeteCarte: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'etablissement' },
);
export const Etablissement = model<IEtablissement>('Etablissement', schema);
