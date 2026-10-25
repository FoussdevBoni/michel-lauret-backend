export type ExportValue =
  | { type: 'null' }
  | { type: 'boolean'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'integer'; value: string }
  | { type: 'number'; value: string }
  | { type: 'timestamp'; seconds: number; nanoseconds: number }
  | { type: 'geopoint'; latitude: number; longitude: number }
  | { type: 'reference'; path: string; resource: string }
  | { type: 'bytes'; base64: string }
  | { type: 'array'; value: ExportValue[] }
  | { type: 'map'; value: Record<string, ExportValue> };

export interface ExportedFirestoreDocument {
  path: string;
  exists: boolean;
  fields?: ExportValue;
  createTime?: ExportValue;
  updateTime?: ExportValue;
}

// Ce port n'expose aucune méthode d'écriture sur Firestore.
export interface FirestoreExportSource {
  projectId: string;
  databaseId: string;
  collections(parentDocument?: string): Promise<string[]>;
  documents(collectionPath: string): AsyncIterable<ExportedFirestoreDocument>;
}

export interface FirestoreExportReport {
  format: 'cpeg-firestore-export';
  version: 1;
  projectId: string;
  databaseId: string;
  startedAt: string;
  completedAt: string;
  consistency: 'live-non-atomic';
  documents: number;
  missingParents: number;
  collections: Record<string, number>;
  sha256: string;
}

export interface MigrationLevel {
  _id: string;
  nom: string;
  cycleId: string;
  niveauScolaireId: string;
}

export interface MigrationDecisions {
  schoolYear: string;
  preserveUnknownBirthDates: true;
  preserveUnknownSex: true;
  deferConflictingAssignments: true;
}

export type ImportDocument = Record<string, unknown> & { _id: string };

export interface FirestoreArchiveRecord {
  _id: string;
  sourceHash: string;
  sourcePath: string;
  document: ExportedFirestoreDocument;
  createdAt: Date;
  updatedAt: Date;
}
