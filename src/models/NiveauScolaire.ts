import mongoose, { Schema, Document } from 'mongoose';

export interface INiveauScolaire extends Document {
  referenceRevision: number;
  nom: string;
  notePlafond: number;
  __v: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NiveauScolaireSchema: Schema = new Schema(
  {
    nom: {
      type: String,
      required: [true, 'Le nom du niveau scolaire est obligatoire'],
      trim: true,
    },
    referenceRevision: { type: Number, default: 0 },
    notePlafond: { type: Number, required: true, default: 20, min: 0.01 },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'niveauscolaires',
  },
);

// Unicité à l'échelle de l'établissement, y compris ses archives.
NiveauScolaireSchema.index({ nom: 1 }, { unique: true });

export const NiveauScolaire = mongoose.model<INiveauScolaire>(
  'NiveauScolaire',
  NiveauScolaireSchema,
);
