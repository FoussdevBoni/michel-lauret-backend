import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { uploadService } from '../src/services/uploadService';

const objects = new Map<string, Buffer>();
let server: Server;
let bucketCreated = false;
let publicBucket = false;
const original = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_MEDIA_BUCKET,
};
before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const path = decodeURIComponent(req.url ?? '');
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (path === '/storage/v1/bucket/test-private' && req.method === 'GET') {
      json(
        bucketCreated ? 200 : 404,
        bucketCreated
          ? { id: 'test-private', name: 'test-private', public: publicBucket }
          : { statusCode: '404', message: 'Bucket not found', error: 'not_found' },
      );
      return;
    }
    if (path === '/storage/v1/bucket' && req.method === 'POST') {
      assert.equal(JSON.parse(body.toString()).public, false);
      bucketCreated = true;
      json(200, { name: 'test-private' });
      return;
    }
    const upload = '/storage/v1/object/test-private/';
    const download = '/storage/v1/object/authenticated/test-private/';
    if (path.startsWith(upload) && req.method === 'POST') {
      assert.equal(req.headers['x-upsert'], 'false');
      const key = path.slice(upload.length);
      if (objects.has(key)) {
        json(409, {
          statusCode: '409',
          message: 'Resource already exists',
          error: 'Duplicate',
        });
        return;
      }
      objects.set(key, body);
      json(200, { Key: 'test-private/' + key });
      return;
    }
    if ((path.startsWith(download) || path.startsWith(upload)) && req.method === 'GET') {
      assert.ok(req.headers.authorization?.startsWith('Bearer '));
      const value = objects.get(
        path.slice(path.startsWith(download) ? download.length : upload.length),
      );
      if (!value) {
        json(404, { statusCode: '404', message: 'Object not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(value);
      return;
    }
    if (path === '/storage/v1/object/test-private' && req.method === 'DELETE') {
      for (const key of JSON.parse(body.toString()).prefixes) objects.delete(key);
      json(200, []);
      return;
    }
    json(404, { statusCode: '404', message: 'Unknown test endpoint' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-storage-service-test-key';
  process.env.SUPABASE_MEDIA_BUCKET = 'test-private';
});
after(async () => {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: original.url,
    SUPABASE_SERVICE_ROLE_KEY: original.key,
    SUPABASE_MEDIA_BUCKET: original.bucket,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
test('Storage SDK : bucket privé, fichier immuable, reprise idempotente et suppression réelle via HTTP', async () => {
  const bytes = Buffer.from('image-content-for-sdk-test');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await uploadService.put('school/school/logo/test.png', bytes, 'image/png', hash);
  assert.equal(bucketCreated, true);
  assert.deepEqual(await uploadService.download('school/school/logo/test.png'), bytes);
  await uploadService.put('school/school/logo/test.png', bytes, 'image/png', hash);
  assert.equal(objects.size, 1);
  await assert.rejects(() =>
    uploadService.put(
      'school/school/logo/test.png',
      Buffer.from('different'),
      'image/png',
      'wrong-hash',
    ),
  );
  await uploadService.delete('school/school/logo/test.png');
  assert.equal(objects.size, 0);
});
test('Storage SDK : un bucket public existant est refusé', async () => {
  publicBucket = true;
  try {
    await assert.rejects(() => uploadService.ensureBucket(), /privé/);
  } finally {
    publicBucket = false;
  }
});
