import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFirestoreRestSource,
  encodeRestValue,
} from '../src/lib/firestoreRestSource';

const resource = 'projects/test-project/databases/(default)/documents';
const response = (value: object, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
test('Firestore REST : types et références complets sont conservés sans conversion des entiers en nombres', () => {
  assert.deepEqual(encodeRestValue({ integerValue: '9223372036854775807' }), {
    type: 'integer',
    value: '9223372036854775807',
  });
  assert.deepEqual(
    encodeRestValue({ timestampValue: '2023-11-14T22:13:20.123456789Z' }),
    { type: 'timestamp', seconds: 1700000000, nanoseconds: 123456789 },
  );
  assert.deepEqual(
    encodeRestValue({
      referenceValue: 'projects/foreign/databases/other/documents/students/a',
    }),
    {
      type: 'reference',
      path: 'students/a',
      resource: 'projects/foreign/databases/other/documents/students/a',
    },
  );
  assert.deepEqual(
    encodeRestValue({
      mapValue: {
        fields: { type: { stringValue: 'timestamp' }, list: { arrayValue: {} } },
      },
    }),
    {
      type: 'map',
      value: {
        type: { type: 'string', value: 'timestamp' },
        list: { type: 'array', value: [] },
      },
    },
  );
  assert.deepEqual(encodeRestValue({ doubleValue: 'NaN' }), {
    type: 'number',
    value: 'NaN',
  });
  assert.deepEqual(encodeRestValue({ nullValue: null }), { type: 'null' });
  assert.deepEqual(encodeRestValue({ geoPointValue: {} }), {
    type: 'geopoint',
    latitude: 0,
    longitude: 0,
  });
  assert.throws(() => encodeRestValue({ unsupported: true }), /non pris en charge/);
});
test('Firestore REST : parcourt toutes les pages et découvre les descendants des parents manquants', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      'Bearer synthetic-test-token',
    );
    calls.push(`${options?.method} ${url.pathname}`);
    if (options?.method === 'POST') {
      assert.match(url.pathname, /:listCollectionIds$/);
      const body = JSON.parse(String(options.body));
      if (url.pathname.endsWith('/documents:listCollectionIds'))
        return response(
          body.pageToken
            ? { collectionIds: ['teachers'] }
            : { collectionIds: ['students'], nextPageToken: 'roots-2' },
        );
      return response(
        url.pathname.endsWith('/students/missing:listCollectionIds')
          ? { collectionIds: ['history'] }
          : {},
      );
    }
    assert.equal(url.searchParams.get('showMissing'), 'true');
    assert.equal(url.searchParams.get('pageSize'), '100');
    return response(
      url.searchParams.get('pageToken')
        ? {
            documents: [{ name: resource + '/students/missing' }],
          }
        : {
            documents: [
              {
                name: resource + '/students/a',
                createTime: '2026-01-01T00:00:00Z',
                fields: { matricule: { stringValue: 'ML-1' } },
              },
            ],
            nextPageToken: 'documents-2',
          },
    );
  };
  const source = createFirestoreRestSource(
    'test-project',
    '(default)',
    async () => 'synthetic-test-token',
    request,
  );
  assert.deepEqual(await source.collections(), ['students', 'teachers']);
  const documents = [];
  for await (const document of source.documents('students')) documents.push(document);
  assert.equal(documents.length, 2);
  assert.equal(documents[0].exists, true);
  assert.equal(documents[1].exists, false);
  const previous = calls.length;
  assert.deepEqual(await source.collections('students/missing'), [
    'students/missing/history',
  ]);
  assert.equal(calls.length, previous);
  await source.close();
});
test('Firestore REST : le refus de permission ne provoque pas de nouvelles tentatives', async () => {
  let calls = 0;
  const source = createFirestoreRestSource(
    'test-project',
    '(default)',
    async () => 'test-token',
    async () => {
      calls++;
      return response({}, 403);
    },
  );
  await assert.rejects(source.collections(), { code: 403 });
  assert.equal(calls, 1);
});
test('Firestore REST : une indisponibilité temporaire est réessayée sans changer la requête', async () => {
  const calls: string[] = [];
  const source = createFirestoreRestSource(
    'test-project',
    '(default)',
    async () => 'test-token',
    async (input) => {
      calls.push(String(input));
      return calls.length === 1
        ? response({}, 503)
        : response({ collectionIds: ['notes'] });
    },
  );
  assert.deepEqual(await source.collections(), ['notes']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test('Firestore REST : un délai réseau expiré est réessayé comme une coupure, pas comme un refus HTTP', async () => {
  let calls = 0;
  const source = createFirestoreRestSource(
    'test-project',
    '(default)',
    async () => 'test-token',
    async () => {
      calls++;
      if (calls === 1) throw new DOMException('Timeout simulé', 'TimeoutError');
      return response({ collectionIds: ['notes'] });
    },
  );
  assert.deepEqual(await source.collections(), ['notes']);
  assert.equal(calls, 2);
});
test('Firestore REST : la découverte des sous-collections reste limitée à huit appels concurrents', async () => {
  let active = 0;
  let peak = 0;
  const source = createFirestoreRestSource(
    'test-project',
    '(default)',
    async () => 'test-token',
    async (_input, options) => {
      if (options?.method === 'GET')
        return response({
          documents: Array.from({ length: 25 }, (_, i) => ({
            name: `${resource}/notes/${i}`,
            fields: {},
          })),
        });
      active++;
      peak = Math.max(peak, active);
      await new Promise((done) => setTimeout(done, 2));
      active--;
      return response({});
    },
  );
  let count = 0;
  for await (const _document of source.documents('notes')) count++;
  assert.equal(count, 25);
  assert.ok(peak <= 8 && peak > 1);
});
