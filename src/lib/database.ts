import mongoose from 'mongoose';
import { env } from '../config/env';
import type { HealthResponse } from '../types/features/Health';

export async function connectDatabase(): Promise<void> {
  if (!env.MONGO_URI) {
    console.log('MongoDB non configuré : démarrage du socle Express uniquement.');
    return;
  }

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
  });

  console.log('Connexion MongoDB établie.');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function getDatabaseStatus(): HealthResponse['database'] {
  if (!env.MONGO_URI) {
    return 'not_configured';
  }

  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
}
