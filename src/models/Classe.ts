import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IClasse extends Document {
  inscriptionRevision: number;
  nom: string;
  niveauClasseId: Types.ObjectId;
  cycleId: Types.ObjectId;
  niveauScolaireId: Types.ObjectId;
  effectifF: number;
  effectifM: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
  createdBy?: string;
  createdByRole?: string;
  ownerId?: string;
}

const ClasseSchema: Schema = new Schema(
  {
    inscriptionRevision: { type: Number, default: 0, select: false },
    nom: {
      type: String,
      required: [true, 'Le nom de la classe est obligatoire'],
      trim: true,
      maxlength: 100,
    },
    niveauClasseId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauClasse',
      required: [true, 'Le niveau de classe est obligatoire'],
      index: true,
    },
    cycleId: {
      type: Schema.Types.ObjectId,
      ref: 'Cycle',
      required: [true, 'Le cycle est obligatoire'],
      index: true,
    },
    niveauScolaireId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauScolaire',
      required: [true, 'Le niveau scolaire est obligatoire'],
      index: true,
    },
    effectifF: {
      type: Number,
      default: 0,
      min: 0,
    },
    effectifM: {
      type: Number,
      default: 0,
      min: 0,
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
    collection: 'classes',
  },
);

// Index pour l'unicité du nom par niveau
ClasseSchema.index({ nom: 1, niveauClasseId: 1 }, { unique: true });

// Index pour les filtres rapides

export const Classe = mongoose.model<IClasse>('Classe', ClasseSchema);
