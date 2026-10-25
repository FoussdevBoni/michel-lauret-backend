import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/app';
import User from '../src/models/User';
import { MediaOperation } from '../src/models/Media';
import { uploadService } from '../src/services/uploadService';
import { getSupabase } from '../src/lib/supabase';

test(
  'Supabase réel : fichier privé, reprise, remplacement et retrait, avec MongoDB isolé',
  { skip: process.env.CPEG_RUN_LIVE_MEDIA_TEST !== '1', timeout: 180000 },
  async () => {
    const databaseName = `cpeg_media_live_test_${randomUUID().replaceAll('-', '')}`;
    const replica = await MongoMemoryReplSet.create({
      binary: {
        version: '7.0.14',
        systemBinary: resolve('node_modules/.cache/mongodb-binaries/mongod-7.0.14.exe'),
      },
      replSet: { count: 1, storageEngine: 'wiredTiger', spawn: { windowsHide: true } },
    });
    let server: Server | undefined;
    const operationIds = [randomUUID(), randomUUID()];
    const ownedPaths = operationIds.map((id) => `school/school/logo/${id}.png`);
    try {
      await mongoose.connect(replica.getUri(databaseName));
      assert.equal(mongoose.connection.name, databaseName);
      await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
      process.env.JWT_SECRET = randomBytes(48).toString('hex');
      const user = await User.create({
        username: 'Isolated upload test',
        email: 'media-test@example.invalid',
        password: randomBytes(24).toString('hex'),
        role: 'admin',
        status: 'active',
        isVerified: true,
      });
      const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '5m',
      });
      server = await new Promise<Server>((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}/api/v1`;
      async function api(method: string, path: string, body?: unknown) {
        const response = await fetch(url + path, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data));
        return data;
      }
      await api('POST', '/etablissement', {
        nom: 'Isolated image test',
        adresse: 'Temporary fixture',
        telephone: '0000',
        email: 'media-test@example.invalid',
        anneeScolaire: '2026-2027',
        version: 0,
      });
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      );
      async function upload(index: number, revision: number) {
        const body = new FormData();
        body.set('operationId', operationIds[index]);
        body.set('revision', String(revision));
        body.set('file', new Blob([bytes], { type: 'image/png' }), 'test.png');
        const response = await fetch(url + '/media/school/school/logo', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body,
          signal: AbortSignal.timeout(60000),
        });
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data));
        return data;
      }
      assert.equal((await upload(0, 0)).revision, 1);
      assert.equal((await upload(0, 0)).revision, 1);
      assert.equal(
        (await api('GET', '/media/school/school/logo')).image,
        `data:image/png;base64,${bytes.toString('base64')}`,
      );
      const bucket = await getSupabase().storage.getBucket(uploadService.bucket());
      assert.equal(bucket.data?.public, false);
      const unauthenticated = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/public/${uploadService.bucket()}/${ownedPaths[0]}`,
        { signal: AbortSignal.timeout(20000) },
      );
      assert.notEqual(unauthenticated.status, 200);
      assert.equal((await upload(1, 1)).revision, 2);
      await api('DELETE', '/media/school/school/logo', {
        operationId: randomUUID(),
        revision: 2,
      });
      assert.equal((await api('POST', '/media/cleanup')).remaining, 0);
      for (const path of ownedPaths)
        assert.ok(
          (await getSupabase().storage.from(uploadService.bucket()).download(path)).error,
        );
      assert.equal(await MediaOperation.countDocuments({ state: 'committed' }), 3);
    } finally {
      // Seulement les deux clés exactes créées par ce test, aucune énumération du bucket.
      try {
        for (const path of ownedPaths) await uploadService.delete(path);
      } finally {
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
        await mongoose.disconnect();
        await replica.stop();
      }
    }
  },
);
