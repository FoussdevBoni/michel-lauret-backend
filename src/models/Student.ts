// src/models/tenants/Student.ts

import mongoose, { Schema, Document } from 'mongoose';

export interface IStudent extends Document {
  inscriptionRevision: number;
  nom: string;
  prenom: string;
  dateNaissance?: Date | null;
  sexe: string; // 'M' | 'F' | '' (non renseigné)
  photo?: string;
  matricule?: string;
  statut?: string; // 'actif' | 'inactif' | 'exclu'
  statutScolaire?: string; // 'passant' | 'redoublant' | 'transfere'
  lieuDeNaissance?: string;
  contact?: string;
  __v: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  createdByRole?: string;
}

const StudentSchema: Schema = new Schema(
  {
    inscriptionRevision: { type: Number, default: 0, select: false },
    nom: {
      type: String,
      required: [true, 'Le nom est obligatoire'],
      trim: true,
    },
    prenom: {
      type: String,
      required: [true, 'Le prénom est obligatoire'],
      trim: true,
    },
    dateNaissance: {
      type: Date,
      default: null,
    },
    sexe: {
      type: String,
      enum: ['M', 'F', ''],
      default: '',
    },
    photo: {
      type: String,
      trim: true,
    },
    matricule: {
      type: String,
      trim: true,
      uppercase: true,
    },
    statut: {
      type: String,
      enum: ['actif', 'inactif', 'exclu'],
      default: 'actif',
    },
    statutScolaire: {
      type: String,
      enum: ['passant', 'redoublant', 'transfere'],
    },
    lieuDeNaissance: {
      type: String,
      trim: true,
    },
    contact: {
      type: String,
      trim: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    createdBy: {
      type: String,
    },
    createdByRole: {
      type: String,
      enum: ['admin', 'school', 'enseignant', 'parent'],
    },
    ownerId: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'elevedatas',
  },
);

// Le matricule est unique dans cet établissement, y compris dans ses archives.
StudentSchema.index({ matricule: 1 }, { unique: true, sparse: true });

export const Student = mongoose.model<IStudent>('Student', StudentSchema);
