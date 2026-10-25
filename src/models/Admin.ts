import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
  nom: string;

  logo?: string;
  enTeteCarte?: string;
  pays?: string;
  adresse?: string;
  telephone: string;
  email?: string;
  siteWeb?: string;
  anneeScolaire: string;
  devise?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema: Schema = new Schema(
  {
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

export const Admin = mongoose.model<IAdmin>('Admin', AdminSchema);
