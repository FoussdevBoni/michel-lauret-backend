import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICycle extends Document {
  referenceRevision: number;
  nom: string;
  niveauScolaireId: Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
}

const CycleSchema = new Schema<ICycle>(
  {
    referenceRevision: { type: Number, default: 0 },
    nom: { type: String, required: true, trim: true, maxlength: 100 },
    niveauScolaireId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauScolaire',
      required: true,
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

// Un même nom peut être utilisé dans des niveaux scolaires différents.
CycleSchema.index({ nom: 1, niveauScolaireId: 1 }, { unique: true });

export const Cycle = model<ICycle>('Cycle', CycleSchema);
