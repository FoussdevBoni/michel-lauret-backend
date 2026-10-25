import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';
import type { ExportValue } from '../types/features/FirestoreMigration';

// Chaque valeur est typée pour conserver les références, les nanosecondes et les
// entiers 64 bits sans confondre un champ métier avec une marque de sérialisation.
export function encodeFirestoreValue(value: unknown): ExportValue {
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'bigint') return { type: 'integer', value: String(value) };
  if (typeof value === 'number')
    return { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  if (value instanceof Timestamp)
    return { type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint)
    return { type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) {
    // Le SDK utilise ce getter pour qualifier ses références, mais ne l'expose
    // pas dans ses déclarations publiques TypeScript. Vérifier sa valeur réelle.
    const projectId: unknown = Reflect.get(value.firestore, 'projectId');
    if (typeof projectId !== 'string' || !projectId)
      throw new Error('Projet de référence Firestore introuvable.');
    return {
      type: 'reference',
      path: value.path,
      resource: `projects/${projectId}/databases/${value.firestore.databaseId}/documents/${value.path}`,
    };
  }
  if (Buffer.isBuffer(value)) return { type: 'bytes', base64: value.toString('base64') };
  if (Array.isArray(value))
    return { type: 'array', value: value.map(encodeFirestoreValue) };
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return {
      type: 'map',
      value: Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)]),
      ),
    };
  throw new Error(
    'Type Firestore non pris en charge : export interrompu sans perte silencieuse.',
  );
}
