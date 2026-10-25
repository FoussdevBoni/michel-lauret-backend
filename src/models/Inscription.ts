// src/models/configurations/Inscription.ts

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IInscription extends Document {
  referenceRevision: number;
  anneeScolaire: string;
  dateInscription: Date;
  dateInscriptionOrigine?: 'saisie' | 'premiere_trace_source';
  statutScolaire?: string;
  classeId: Types.ObjectId;
  eleveDataId: Types.ObjectId;
  isActive: boolean;
  __v: number;
  vieScolaire?: Array<{
    periodeId: Types.ObjectId;
    score: {
      absences: number;
      retards: number;
      conduite: number | null;
    };
  }>;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  createdByRole?: string;
  ownerId?: string;
}

const InscriptionSchema: Schema = new Schema(
  {
    referenceRevision: { type: Number, default: 0 },
    anneeScolaire: {
      type: String,
      required: [true, "L'année scolaire est obligatoire"],
      trim: true,
    },
    dateInscription: {
      type: Date,
      required: [true, "La date d'inscription est obligatoire"],
      default: Date.now,
    },
    statutScolaire: {
      type: String,
      enum: ['nouveau', 'redoublant', 'transfert', 'passant', ''],
      default: 'nouveau',
    },
    dateInscriptionOrigine: {
      type: String,
      enum: ['saisie', 'premiere_trace_source'],
      default: 'saisie',
    },
    classeId: {
      type: Schema.Types.ObjectId,
      ref: 'Classe',
      required: [true, 'La classe est obligatoire'],
    },
    eleveDataId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, "L'élève est obligatoire"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    vieScolaire: [
      {
        periodeId: {
          type: Schema.Types.ObjectId,
          ref: 'Periode',
        },
        score: {
          absences: {
            type: Number,
            default: 0,
            min: 0,
          },
          retards: {
            type: Number,
            default: 0,
            min: 0,
          },
          conduite: {
            type: Number,
            default: null,
            min: 0,
            max: 20,
          },
        },
      },
    ],

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
  },
  {
    timestamps: true,
    collection: 'inscriptions',
  },
);

// Index pour l'unicité : un élève ne peut être inscrit qu'une fois par année dans une classe
InscriptionSchema.index(
  { eleveDataId: 1, anneeScolaire: 1, classeId: 1 },
  {
    name: 'unique_inscription_student_year_class',
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

// Index pour les requêtes
InscriptionSchema.index({ classeId: 1 });
InscriptionSchema.index({ eleveDataId: 1, createdAt: -1 });
InscriptionSchema.index({ isActive: 1 });

InscriptionSchema.index(
  { eleveDataId: 1 },
  {
    name: 'unique_active_inscription_per_student',
    unique: true,
    partialFilterExpression: { isDeleted: false, isActive: true },
  },
);

export const Inscription = mongoose.model<IInscription>('Inscription', InscriptionSchema);
