import { Schema, model, type Document, type Types } from 'mongoose';
export interface IEvaluation extends Document {
  nom: string;
  nomNormalise: string;
  abreviation: string;
  type: 'composition' | 'devoir' | 'interrogation';
  coefficient: number;
  obligatoire?: boolean;
  periodeId?: Types.ObjectId | null;
  niveauScolaireId?: Types.ObjectId | null;
  referenceRevision: number;
  __v: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new Schema<IEvaluation>(
  {
    nom: { type: String, required: true, trim: true, maxlength: 100 },
    nomNormalise: { type: String, required: true },
    abreviation: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      default: '',
    },
    type: {
      type: String,
      enum: ['composition', 'devoir', 'interrogation'],
      required: true,
    },
    obligatoire: { type: Boolean, default: true },
    coefficient: {
      type: Number,
      required: true,
      min: Number.MIN_VALUE,
      max: 10,
      default: 1,
    },
    periodeId: { type: Schema.Types.ObjectId, ref: 'Periode', default: null },
    niveauScolaireId: {
      type: Schema.Types.ObjectId,
      ref: 'NiveauScolaire',
      default: null,
    },
    referenceRevision: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'evaluations' },
);
schema.index(
  { periodeId: 1, niveauScolaireId: 1, type: 1, nomNormalise: 1 },
  {
    name: 'unique_evaluation_name_per_scope_type',
    unique: true,
    partialFilterExpression: { nomNormalise: { $type: 'string' } },
  },
);
schema.index({ periodeId: 1 });
schema.index({ niveauScolaireId: 1 });
export const Evaluation = model<IEvaluation>('Evaluation', schema);
