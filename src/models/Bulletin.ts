import { Schema, model, type Document, type Types } from 'mongoose';
import type { Bulletin as BulletinData } from '../types/features/Bulletin';

export interface IBulletin extends Document {
  inscriptionId: Types.ObjectId;
  periodeId: Types.ObjectId;
  classeId: Types.ObjectId;
  anneeScolaire?: string;
  status: string;
  needsRecalculation: boolean;
  vieScolaire: BulletinData['vieScolaire'];
  commentaires: BulletinData['commentaires'];
  moyennesParMatiere: BulletinData['moyennesParMatiere'];
  resultatFinal: BulletinData['resultatFinal'];
  infosDeClasse: BulletinData['infosDeClasse'];
  notesManquantes: BulletinData['notesManquantes'];
  configCalcul?: BulletinData['configCalcul'];
  calculatedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}
const schema = new Schema<IBulletin>(
  {
    inscriptionId: { type: Schema.Types.ObjectId, ref: 'Inscription', required: true },
    periodeId: { type: Schema.Types.ObjectId, ref: 'Periode', required: true },
    classeId: { type: Schema.Types.ObjectId, ref: 'Classe', required: true },
    anneeScolaire: String,
    status: {
      type: String,
      enum: ['brouillon', 'incomplet', 'a_finaliser', 'complet'],
      default: 'brouillon',
    },
    needsRecalculation: { type: Boolean, default: true },
    vieScolaire: {
      type: Schema.Types.Mixed,
      default: () => ({ absences: 0, retards: 0, conduite: null }),
    },
    commentaires: {
      type: Schema.Types.Mixed,
      default: () => ({ decisionConseil: '', observations: '' }),
    },
    moyennesParMatiere: { type: Schema.Types.Mixed, default: () => [] },
    resultatFinal: { type: Schema.Types.Mixed, default: null },
    infosDeClasse: { type: Schema.Types.Mixed, default: () => ({ effectif: 0 }) },
    notesManquantes: { type: Schema.Types.Mixed, default: () => [] },
    configCalcul: Schema.Types.Mixed,
    calculatedAt: Date,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, collection: 'bulletins' },
);
// Les brouillons historiques peuvent ne pas encore porter isDeleted.
schema.index({ inscriptionId: 1, periodeId: 1 }, { unique: true });
schema.index({ classeId: 1, periodeId: 1 });
export const Bulletin = model<IBulletin>('Bulletin', schema);
