import { Schema, model, type Document, type Types } from 'mongoose';
export interface IMatiere extends Document {
  nom: string;
  nomNormalise: string;
  coefficient: number;
  niveauClasseId: Types.ObjectId;
  cycleId: Types.ObjectId;
  niveauScolaireId: Types.ObjectId;
  referenceRevision: number;
  __v: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new Schema<IMatiere>(
  {
    nom: { type: String, required: true, trim: true, maxlength: 100 },
    nomNormalise: { type: String, required: true },
    coefficient: { type: Number, required: true, min: Number.MIN_VALUE },
    niveauClasseId: { type: Schema.Types.ObjectId, ref: 'NiveauClasse', required: true },
    cycleId: { type: Schema.Types.ObjectId, ref: 'Cycle', required: true },
    niveauScolaireId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauScolaire',
      required: true,
    },
    referenceRevision: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'matieres' },
);
// Les noms restent réservés dans les archives. L'index partiel tolère les anciens
// documents à reprendre, sans leur inventer une normalisation lors du démarrage.
schema.index(
  { niveauClasseId: 1, nomNormalise: 1 },
  {
    name: 'unique_subject_normalized_name_per_level',
    unique: true,
    partialFilterExpression: { nomNormalise: { $type: 'string' } },
  },
);
schema.index({ niveauClasseId: 1 });
export const Matiere = model<IMatiere>('Matiere', schema);
