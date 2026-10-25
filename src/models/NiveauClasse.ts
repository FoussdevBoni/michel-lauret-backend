import { Schema, model, Document, Types } from 'mongoose';

export interface INiveauClasse extends Document {
  referenceRevision: number;
  nom: string;
  cycleId: Types.ObjectId;
  niveauScolaireId: Types.ObjectId;
  __v: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NiveauClasseSchema = new Schema<INiveauClasse>(
  {
    referenceRevision: { type: Number, default: 0 },
    nom: {
      type: String,
      required: [true, 'Le nom du niveau de classe est obligatoire.'],
      trim: true,
      maxlength: 100,
    },
    cycleId: {
      type: Schema.Types.ObjectId,
      ref: 'Cycle',
      required: [true, "L'identifiant du cycle est obligatoire."],
    },
    niveauScolaireId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauScolaire',
      required: [true, "L'identifiant du NiveauScolaire est obligatoire."],
    },

    isDeleted: {
      type: Boolean,
      default: false,
      required: true,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

// Le même nom peut être utilisé dans des cycles différents.
NiveauClasseSchema.index({ nom: 1, cycleId: 1 }, { unique: true });

export const NiveauClasse = model<INiveauClasse>('NiveauClasse', NiveauClasseSchema);
