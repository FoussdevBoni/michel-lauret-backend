import { setTimeout as delay } from 'node:timers/promises';
import type {
  ExportValue,
  FirestoreExportSource,
} from '../types/features/FirestoreMigration';

type RestValue = Record<string, unknown>;
class FirestoreReadError extends Error {
  constructor(readonly code: number) {
    super('Lecture Firestore refusée.');
  }
}
export function encodeRestValue(value: RestValue): ExportValue {
  if (Object.hasOwn(value, 'nullValue')) return { type: 'null' };
  if (typeof value.stringValue === 'string')
    return { type: 'string', value: value.stringValue };
  if (typeof value.booleanValue === 'boolean')
    return { type: 'boolean', value: value.booleanValue };
  if (typeof value.integerValue === 'string' && /^-?\d+$/.test(value.integerValue))
    return { type: 'integer', value: value.integerValue };
  if (typeof value.doubleValue === 'number' || typeof value.doubleValue === 'string')
    return {
      type: 'number',
      value: Object.is(value.doubleValue, -0) ? '-0' : String(value.doubleValue),
    };
  if (typeof value.timestampValue === 'string') {
    const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
      value.timestampValue,
    );
    if (!parts || Number.isNaN(Date.parse(parts[1] + 'Z')))
      throw new Error('Horodatage Firestore invalide.');
    return {
      type: 'timestamp',
      seconds: Math.floor(Date.parse(parts[1] + 'Z') / 1000),
      nanoseconds: Number((parts[2] ?? '').padEnd(9, '0')),
    };
  }
  if (typeof value.referenceValue === 'string') {
    const index = value.referenceValue.indexOf('/documents/');
    if (index < 0) throw new Error('Référence Firestore invalide.');
    return {
      type: 'reference',
      path: value.referenceValue.slice(index + 11),
      resource: value.referenceValue,
    };
  }
  if (typeof value.bytesValue === 'string')
    return { type: 'bytes', base64: value.bytesValue };
  if (value.geoPointValue && typeof value.geoPointValue === 'object') {
    const point = value.geoPointValue as { latitude?: number; longitude?: number };
    // Les coordonnées nulles peuvent être omises par la sérialisation protobuf.
    return {
      type: 'geopoint',
      latitude: point.latitude ?? 0,
      longitude: point.longitude ?? 0,
    };
  }
  if (value.arrayValue && typeof value.arrayValue === 'object')
    return {
      type: 'array',
      value: ((value.arrayValue as { values?: RestValue[] }).values ?? []).map(
        encodeRestValue,
      ),
    };
  if (value.mapValue && typeof value.mapValue === 'object')
    return {
      type: 'map',
      value: encodeRestFields(
        (value.mapValue as { fields?: Record<string, RestValue> }).fields ?? {},
      ),
    };
  throw new Error(
    'Type Firestore non pris en charge : export interrompu sans perte silencieuse.',
  );
}
function encodeRestFields(fields: Record<string, RestValue>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, encodeRestValue(value)]),
  );
}
interface RestDocument {
  name: string;
  fields?: Record<string, RestValue>;
  createTime?: string;
  updateTime?: string;
}
export function createFirestoreRestSource(
  projectId: string,
  databaseId: string,
  getToken: () => Promise<string>,
  request: typeof fetch = fetch,
): FirestoreExportSource & { close(): Promise<void> } {
  const resource = `projects/${projectId}/databases/${databaseId}/documents`;
  const prefix = 'https://firestore.googleapis.com/v1/';
  const childCache = new Map<string, string[]>();
  async function read(path: string, body?: object): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      try {
        const token = await getToken();
        const response = await request(prefix + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          const error = new FirestoreReadError(response.status);
          if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt >= 3)
            throw error;
        } else return (await response.json()) as Record<string, unknown>;
      } catch (cause) {
        if (
          attempt >= 3 ||
          (cause instanceof FirestoreReadError &&
            ![408, 429, 500, 502, 503, 504].includes(cause.code))
        )
          throw cause;
      }
      await delay(500 * 2 ** attempt);
    }
  }
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
  async function collectionPaths(parent?: string) {
    const parentResource = `${resource}${parent ? '/' + parent : ''}`;
    const paths: string[] = [];
    let pageToken: string | undefined;
    do {
      const data = await read(`${encodePath(parentResource)}:listCollectionIds`, {
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const id of (data.collectionIds ?? []) as string[])
        paths.push(parent ? `${parent}/${id}` : id);
      pageToken = data.nextPageToken as string | undefined;
    } while (pageToken);
    return paths.sort();
  }
  return {
    projectId,
    databaseId,
    async collections(parent) {
      if (parent && childCache.has(parent)) {
        const result = childCache.get(parent)!;
        childCache.delete(parent);
        return result;
      }
      return collectionPaths(parent);
    },
    async *documents(collectionPath) {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          pageSize: '100',
          showMissing: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        const data = await read(
          `${encodePath(`${resource}/${collectionPath}`)}?${params}`,
        );
        const documents = (data.documents ?? []) as RestDocument[];
        for (const document of documents)
          if (!document.name.startsWith(resource + '/'))
            throw new Error('Chemin de document incohérent.');
        // La découverte des descendants est limitée à huit requêtes simultanées.
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(8, documents.length) }, async () => {
            while (next < documents.length) {
              const document = documents[next++];
              const path = document.name.slice(resource.length + 1);
              childCache.set(path, await collectionPaths(path));
            }
          }),
        );
        for (const document of documents) {
          const exists = !!(
            document.createTime ||
            document.updateTime ||
            document.fields
          );
          yield {
            path: document.name.slice(resource.length + 1),
            exists,
            ...(exists
              ? {
                  fields: {
                    type: 'map' as const,
                    value: encodeRestFields(document.fields ?? {}),
                  },
                }
              : {}),
            ...(document.createTime
              ? { createTime: encodeRestValue({ timestampValue: document.createTime }) }
              : {}),
            ...(document.updateTime
              ? { updateTime: encodeRestValue({ timestampValue: document.updateTime }) }
              : {}),
          };
        }
        pageToken = data.nextPageToken as string | undefined;
      } while (pageToken);
    },
    async close() {
      childCache.clear();
    },
  };
}
