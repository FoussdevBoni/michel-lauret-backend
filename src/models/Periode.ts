import mongoose, { Schema, type Document, type Types } from 'mongoose';
export interface IPeriode extends Document {
  nom: string;
  ordre: number;
  coefficient: number;
  niveauScolaireId?: Types.ObjectId | null;
  dateDebut?: string;
  dateFin?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  referenceRevision: number;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new Schema<IPeriode>(
  {
    nom: { type: String, required: true, trim: true },
    ordre: { type: Number, required: true, min: 1, max: 20 },
    coefficient: {
      type: Number,
      required: true,
      min: Number.MIN_VALUE,
      max: 10,
      default: 1,
    },
    niveauScolaireId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauScolaire',
      default: null,
    },
    dateDebut: String,
    dateFin: String,
    referenceRevision: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'periodes' },
);
schema.index(
  { niveauScolaireId: 1, ordre: 1 },
  // Nom distinct de l'ancien index partiel : renforce l'unicité sans le supprimer.
  { name: 'unique_period_order_per_level_all', unique: true },
);
export const Periode = mongoose.model<IPeriode>('Periode', schema);
