import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../../src/app';
import User from '../../src/models/User';
import { MediaSlot } from '../../src/models/Media';
import { uploadService } from '../../src/services/uploadService';
import { HttpError } from '../../src/utils/HttpError';

async function start() {
  const replica = await MongoMemoryReplSet.create({
    binary: {
      version: '7.0.14',
      systemBinary: resolve('node_modules/.cache/mongodb-binaries/mongod-7.0.14.exe'),
    },
    replSet: { count: 1, storageEngine: 'wiredTiger', spawn: { windowsHide: true } },
  });
  await mongoose.connect(
    replica.getUri(`cpeg_media_browser_test_${randomBytes(10).toString('hex')}`),
  );
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  await User.create({
    email: 'browser@example.invalid',
    username: 'Browser Test Admin',
    password: 'browser-password-only',
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  const objects = new Map<string, Buffer>();
  let rejectNext = false;
  uploadService.put = async (key, bytes) => {
    if (rejectNext) {
      rejectNext = false;
      throw new HttpError(503, 'Coupure de test. Réessayez.');
    }
    objects.set(key, bytes);
  };
  uploadService.download = async (key) => {
    const value = objects.get(key);
    if (!value) throw new HttpError(404, 'Image absente.');
    return value;
  };
  uploadService.delete = async (key) => {
    objects.delete(key);
  };
  const fixture = express();
  fixture.use(express.json());
  fixture.post('/__test/reject-once', (_req, res) => {
    rejectNext = true;
    res.json({ ok: true });
  });
  fixture.post('/__test/external-change', async (_req, res) => {
    await MediaSlot.updateOne({ entity: 'student' }, { $inc: { revision: 1 } });
    res.json({ ok: true });
  });
  fixture.get('/__test/state', async (_req, res) => {
    res.json({
      objects: objects.size,
      students: await mongoose.connection.db!.collection('elevedatas').countDocuments(),
    });
  });
  fixture.use(app);
  const server = fixture.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Adresse de test absente.');
    const state = { url: `http://127.0.0.1:${address.port}` };
    if (process.env.MEDIA_BROWSER_READY_FILE)
      writeFileSync(process.env.MEDIA_BROWSER_READY_FILE, JSON.stringify(state));
    console.log(JSON.stringify(state));
  });
  async function stop() {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mongoose.disconnect();
    await replica.stop();
    process.exit(0);
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
