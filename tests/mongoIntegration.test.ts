import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/app';
import User from '../src/models/User';
import { uploadService } from '../src/services/uploadService';
import { MediaSlot, MediaCleanup } from '../src/models/Media';
import { MediaOperation } from '../src/models/Media';
import type { BulletinWithDetails } from '../src/types/features/Bulletin';
import {
  etablissementFields,
  type Etablissement,
} from '../src/types/features/Etablissement';

interface Entity {
  id: string;
  version: number;
  isActive: boolean;
  classeId: string;
  eleveDataId: string;
}
async function withMediaStore(work: (objects: Map<string, Buffer>) => Promise<void>) {
  const original = {
    put: uploadService.put,
    download: uploadService.download,
    delete: uploadService.delete,
  };
  const objects = new Map<string, Buffer>();
  uploadService.put = async (key, bytes) => {
    objects.set(key, bytes);
  };
  uploadService.download = async (key) => {
    assert.ok(objects.has(key));
    return objects.get(key)!;
  };
  uploadService.delete = async (key) => {
    objects.delete(key);
  };
  try {
    await work(objects);
  } finally {
    Object.assign(uploadService, original);
  }
}
test('HTTP médias : upload et suppression en lots avec succès et erreurs indexés', async () =>
  withMediaStore(async (objects) => {
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    const body = new FormData();
    const items = ['logo', 'enTeteCarte'].map((kind, fileIndex) => ({
      target: { entity: 'school', targetId: 'school', kind },
      operationId: randomUUID(),
      revision: 0,
      fileIndex,
    }));
    body.set('items', JSON.stringify(items));
    body.append(
      'files',
      new Blob([Buffer.from(schoolPng.split(',')[1], 'base64')], { type: 'image/png' }),
      'valid.png',
    );
    body.append(
      'files',
      new Blob([Buffer.from('invalid-image-content')], { type: 'image/png' }),
      'invalid.png',
    );
    const response = await fetch(baseUrl + '/media/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.success.length, 1);
    assert.equal(result.errors[0].index, 1);
    const removed = await api<{ success: unknown[]; errors: { index: number }[] }>(
      'DELETE',
      '/media/batch',
      {
        items: [
          { target: items[0].target, operationId: randomUUID(), revision: 1 },
          {
            target: {
              entity: 'student',
              targetId: '000000000000000000000000',
              kind: 'photo',
            },
            operationId: randomUUID(),
            revision: 0,
          },
        ],
      },
    );
    assert.equal(removed.body.success.length, 1);
    assert.equal(removed.body.errors[0].index, 1);
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 0);
  }));
test('HTTP médias : le nettoyage des envois interrompus respecte les baux et les références actives', async () =>
  withMediaStore(async (objects) => {
    const id = randomUUID();
    objects.set('orphan.png', Buffer.from('orphan'));
    await mongoose.connection.db!.collection('mediaOperations').insertOne({
      operationId: id,
      key: 'orphan',
      ownerId: 'test',
      digest: 'test',
      state: 'pending',
      objectKey: 'orphan.png',
      updatedAt: new Date(Date.now() - 172800000),
      leaseUntil: new Date(Date.now() + 60000),
    });
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 1);
    await mongoose.connection
      .db!.collection('mediaOperations')
      .updateOne({ operationId: id }, { $unset: { leaseUntil: '' } });
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 0);
    assert.equal((await MediaOperation.findOne({ operationId: id }))?.state, 'pending');
  }));
async function imageRequest(
  path: string,
  operationId: string,
  revision: number,
  image = schoolPng,
) {
  const data = new FormData();
  data.set('operationId', operationId);
  data.set('revision', String(revision));
  data.set(
    'file',
    new Blob([Buffer.from(image.split(',')[1], 'base64')], { type: 'image/png' }),
    'image.png',
  );
  const response = await fetch(baseUrl + path, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      revision: number;
      operationId: string;
      message?: string;
    },
  };
}
test('HTTP médias : connexion valide, session invalide et droits du compte', async () => {
  const loggedIn = await api<{ token: string; user: { id: string } }>(
    'POST',
    '/auth/login',
    { email: 'admin@example.invalid', password: 'test-password-only' },
  );
  assert.equal(loggedIn.status, 200);
  assert.ok(loggedIn.body.token);
  assert.ok(loggedIn.body.user.id);
  assert.equal((await api('GET', '/auth/me')).status, 200);
  assert.equal(
    (
      await api('POST', '/auth/login', {
        email: 'admin@example.invalid',
        password: 'wrong',
      })
    ).status,
    401,
  );
  await User.updateOne({ email: 'admin@example.invalid' }, { $set: { role: 'teacher' } });
  assert.equal((await api('GET', '/auth/me')).status, 200);
  assert.equal((await api('GET', '/students')).status, 403);
});
test('HTTP médias : ajout, téléchargement privé, remplacement, suppression et nettoyage durable', async () =>
  withMediaStore(async (objects) => {
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    const path = '/media/school/school/logo';
    const firstId = randomUUID();
    const first = await imageRequest(path, firstId, 0);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.revision, 1);
    assert.equal((await imageRequest(path, firstId, 0)).status, 200);
    assert.equal(objects.size, 1);
    assert.equal((await api<{ image: string }>('GET', path)).body.image, schoolPng);
    assert.equal((await fetch(baseUrl + path)).status, 401);
    assert.equal((await imageRequest(path, randomUUID(), 1)).status, 200);
    assert.equal(objects.size, 2);
    assert.equal(await MediaCleanup.countDocuments(), 1);
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 1);
    assert.equal(
      (await api('DELETE', path, { operationId: randomUUID(), revision: 2 })).status,
      200,
    );
    assert.equal((await api<{ image: null }>('GET', path)).body.image, null);
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 0);
  }));
test('HTTP médias : mauvaise révision et réutilisation d’un identifiant sont refusées sans écrasement', async () =>
  withMediaStore(async (objects) => {
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    const id = randomUUID();
    assert.equal((await imageRequest('/media/school/school/logo', id, 0)).status, 200);
    assert.equal(
      (await imageRequest('/media/school/school/logo', randomUUID(), 0)).status,
      409,
    );
    assert.equal(
      (await imageRequest('/media/school/school/enTeteCarte', id, 0)).status,
      409,
    );
    assert.equal(objects.size, 1);
  }));
test('HTTP médias : envois concurrents sur la même révision, un seul gagnant et aucune suppression du gagnant', async () =>
  withMediaStore(async (objects) => {
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    const result = await Promise.all([
      imageRequest('/media/school/school/logo', randomUUID(), 0),
      imageRequest('/media/school/school/logo', randomUUID(), 0),
    ]);
    assert.deepEqual(result.map((item) => item.status).sort(), [200, 409]);
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 1);
    assert.equal(
      (await api<{ revision: number }>('GET', '/media/school/school/logo')).body.revision,
      1,
    );
  }));
test('HTTP médias : rapprochement d’élève idempotent et rejet d’un matricule d’identité différente', async () => {
  const student = {
    nom: 'Dossou',
    prenom: 'Alice',
    matricule: 'PHOTO001',
    dateNaissance: '2012-01-01',
    sexe: 'F',
  };
  const one = await api<{ targetId: string }>('POST', '/media/parents', {
    entity: 'student',
    data: student,
  });
  const two = await api<{ targetId: string }>('POST', '/media/parents', {
    entity: 'student',
    data: student,
  });
  assert.equal(one.status, 200);
  assert.equal(one.body.targetId, two.body.targetId);
  assert.equal(
    (
      await api('POST', '/media/parents', {
        entity: 'student',
        data: { ...student, prenom: 'Autre' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('POST', '/media/parents', {
        entity: 'student',
        data: { ...student, matricule: 'ABSENT' },
        lookupOnly: true,
      })
    ).status,
    404,
  );
  assert.equal(
    await mongoose.connection.db!.collection('elevedatas').countDocuments(),
    1,
  );
});
test('HTTP médias : photo liée au dossier, archivage et nettoyage de toutes ses photos', async () =>
  withMediaStore(async (objects) => {
    const student = await create('/students', {
      nom: 'Dossou',
      prenom: 'Alice',
      matricule: 'PHOTO1',
      dateNaissance: '2012-01-01',
      sexe: 'F',
    });
    assert.equal(
      (await imageRequest(`/media/student/${student.id}/photo`, randomUUID(), 0)).status,
      200,
    );
    const stored = await mongoose.connection
      .db!.collection('elevedatas')
      .findOne({ _id: new mongoose.Types.ObjectId(student.id) });
    assert.match(stored!.photo, /^media:/);
    assert.equal((await api('DELETE', '/students/' + student.id)).status, 200);
    assert.equal((await api('GET', `/media/student/${student.id}/photo`)).status, 404);
    await api('POST', '/media/cleanup');
    assert.equal(objects.size, 0);
  }));
test('HTTP médias : stockage indisponible conserve la version précédente et permet la reprise', async () =>
  withMediaStore(async () => {
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    const original = uploadService.put;
    const id = randomUUID();
    uploadService.put = async () => {
      throw new Error('storage-unavailable');
    };
    try {
      assert.equal((await imageRequest('/media/school/school/logo', id, 0)).status, 500);
    } finally {
      uploadService.put = original;
    }
    assert.equal(await MediaSlot.countDocuments(), 0);
    assert.equal((await imageRequest('/media/school/school/logo', id, 0)).status, 200);
  }));
interface Batch {
  success: Entity[];
  errors: { index: number; message: string }[];
}
interface Page {
  items: Entity[];
  total: number;
}
test('HTTP MongoDB : bulletins idempotents, conduite zéro, calcul complet et correction de note', async () => {
  const { noteInput, inscription, period } = await noteSetup();
  const identity = { inscriptionId: inscription.id, periodeId: period.id };
  const record = await create('/bulletins', identity);
  assert.equal((await create('/bulletins', identity)).id, record.id);
  const note = await create('/notes', { ...noteInput, note: 10 });
  let current = (await api<BulletinWithDetails>('GET', '/bulletins/' + record.id)).body;
  assert.equal(
    (
      await api('PUT', '/bulletins/' + record.id, {
        version: current.version,
        vieScolaire: { conduite: 0 },
      })
    ).status,
    200,
  );
  const report = await api<{ success: BulletinWithDetails[]; errors: unknown[] }>(
    'POST',
    '/bulletins/generate',
    { periodeId: period.id, bulletinIds: [record.id] },
  );
  assert.equal(report.status, 200);
  assert.deepEqual(report.body.errors, []);
  current = (await api<BulletinWithDetails>('GET', '/bulletins/' + record.id)).body;
  assert.equal(current.status, 'complet');
  assert.equal(current.needsRecalculation, false);
  assert.equal(current.resultatFinal?.moyenneGenerale, 7.5);
  assert.equal(current.resultatFinal?.rang, 1);
  assert.equal(
    (await api('PUT', '/notes/' + note.id, { version: note.version, note: 12 })).status,
    200,
  );
  current = (await api<BulletinWithDetails>('GET', '/bulletins/' + record.id)).body;
  assert.equal(current.needsRecalculation, true);
  assert.equal(current.resultatFinal?.rang, null);
});

test('HTTP MongoDB : configuration singleton versionnée, réinitialisation et résultats invalidés', async () => {
  const { inscription, period } = await noteSetup();
  await create('/bulletins', { inscriptionId: inscription.id, periodeId: period.id });
  type Config = {
    version: number;
    config: {
      interrogation: { actif: boolean; mode: string };
      devoir: { actif: boolean; mode: string };
      composition: { actif: boolean; mode: string };
    };
  };
  const config = (await api<Config>('GET', '/bulletins/config')).body;
  const changed = await api<Config>('PUT', '/bulletins/config', {
    ...config,
    config: { ...config.config, devoir: { actif: true, mode: 'moyenne' } },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.version, 1);
  assert.equal((await api('PUT', '/bulletins/config', config)).status, 409);
  assert.equal(
    (await api('DELETE', '/bulletins/config', { version: changed.body.version })).status,
    200,
  );
  assert.equal(
    (await api<Config>('GET', '/bulletins/config')).body.config.devoir.mode,
    'conserver',
  );
});

test('HTTP MongoDB : suppression atomique, restauration explicite et notes préservées', async () => {
  const { noteInput } = await noteSetup();
  const note = await create('/notes', noteInput);
  const [record] = (await api<BulletinWithDetails[]>('GET', '/bulletins')).body;
  assert.equal(
    (
      await api('DELETE', '/bulletins/batch', {
        ids: [record.id, '000000000000000000000000'],
      })
    ).status,
    404,
  );
  assert.equal((await api('GET', '/bulletins/' + record.id)).status, 200);
  assert.equal((await api('DELETE', '/bulletins/' + record.id)).status, 200);
  assert.equal((await api('GET', '/bulletins/' + record.id)).status, 404);
  assert.equal((await api('GET', '/notes/' + note.id)).status, 200);
  assert.equal((await api('DELETE', '/notes/' + note.id)).status, 409);
  const [archived] = (
    await api<BulletinWithDetails[]>('GET', '/bulletins?includeDeleted=true')
  ).body;
  assert.equal(
    (
      await api('POST', '/bulletins/' + record.id + '/restore', {
        version: archived.version,
      })
    ).status,
    200,
  );
  assert.equal((await api('GET', '/bulletins/' + record.id)).status, 200);
});

test('HTTP MongoDB : enregistrement refuse les résultats clients, conserve null et détecte les versions périmées', async () => {
  const { inscription, period } = await noteSetup();
  const identity = { inscriptionId: inscription.id, periodeId: period.id };
  const saved = await api<BulletinWithDetails>('PUT', '/bulletins/save', {
    ...identity,
    data: {
      vieScolaire: { conduite: null, absences: 2, retards: 1 },
      commentaires: { observations: 'Test' },
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.vieScolaire.conduite, null);
  const entry = await mongoose.connection
    .db!.collection('inscriptions')
    .findOne({ _id: new mongoose.Types.ObjectId(inscription.id) });
  assert.equal(entry?.vieScolaire[0].score.absences, 2);
  assert.equal(entry?.vieScolaire[0].score.conduite, null);
  assert.equal(
    (
      await api('PUT', '/bulletins/' + saved.body.id, {
        version: 0,
        commentaires: { observations: 'Périmée' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('PUT', '/bulletins/' + saved.body.id, {
        version: saved.body.version,
        resultatFinal: { moyenneGenerale: 20 },
      })
    ).status,
    400,
  );
});

test('HTTP MongoDB : lots de création et calcul avec erreurs indexées, lectures ciblées et année obligatoire', async () => {
  const { inscription, period, first } = await noteSetup();
  const batch = await api<{
    success: BulletinWithDetails[];
    errors: { index: number }[];
  }>('POST', '/bulletins/batch', {
    periodeId: period.id,
    inscriptionIds: [inscription.id, '000000000000000000000000'],
  });
  assert.equal(batch.body.success.length, 1);
  assert.equal(batch.body.errors[0].index, 1);
  const record = batch.body.success[0];
  const result = await api<{
    success: BulletinWithDetails[];
    errors: { index: number }[];
  }>('POST', '/bulletins/generate', {
    periodeId: period.id,
    bulletinIds: [record.id, '000000000000000000000000'],
  });
  assert.equal(result.body.success[0].status, 'incomplet');
  assert.equal(result.body.errors[0].index, 1);
  assert.equal(
    (await api('GET', `/bulletins/by-classe-and-periode/${first.id}/${period.id}`))
      .status,
    400,
  );
  assert.equal(
    (
      await api<BulletinWithDetails[]>(
        'GET',
        `/bulletins/by-classe-and-periode/${first.id}/${period.id}?anneeScolaire=2024-2025`,
      )
    ).body.length,
    1,
  );
  assert.equal(
    (
      await api<BulletinWithDetails>(
        'GET',
        `/bulletins/by-periode-and-inscription/${period.id}/${inscription.id}`,
      )
    ).body.id,
    record.id,
  );
  assert.equal(
    (await api<BulletinWithDetails[]>('GET', '/bulletins/by-periode/' + period.id)).body
      .length,
    1,
  );
});

test('HTTP MongoDB : création concurrente aboutit à un seul bulletin', async () => {
  const { inscription, period } = await noteSetup();
  const identity = { inscriptionId: inscription.id, periodeId: period.id };
  const result = await Promise.all([
    api('POST', '/bulletins', identity),
    api('POST', '/bulletins', identity),
  ]);
  assert.deepEqual(
    result.map((entry) => entry.status),
    [201, 201],
  );
  assert.equal(result[0].body.id, result[1].body.id);
  assert.equal((await api<BulletinWithDetails[]>('GET', '/bulletins')).body.length, 1);
});

test('HTTP MongoDB : une nouvelle évaluation invalide le bulletin sans laisser un rang périmé', async () => {
  const { noteInput, period } = await noteSetup();
  await create('/notes', noteInput);
  let [record] = (await api<BulletinWithDetails[]>('GET', '/bulletins')).body;
  await api('PUT', '/bulletins/' + record.id, {
    version: record.version,
    vieScolaire: { conduite: 20 },
  });
  await api('POST', '/bulletins/generate', {
    periodeId: period.id,
    bulletinIds: [record.id],
  });
  record = (await api<BulletinWithDetails>('GET', '/bulletins/' + record.id)).body;
  assert.equal(record.needsRecalculation, false);
  await create('/evaluations', {
    nom: 'Nouveau devoir',
    type: 'devoir',
    coefficient: 1,
    periodeId: period.id,
  });
  record = (await api<BulletinWithDetails>('GET', '/bulletins/' + record.id)).body;
  assert.equal(record.needsRecalculation, true);
  assert.equal(record.resultatFinal?.rang, null);
});
let replica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let baseUrl = '';
let token = '';

const schoolInput = () =>
  etablissementFields.parse({
    nom: 'CPEG Michel Lauret',
    adresse: 'Adresse de test',
    telephone: '+229 0100000000',
    email: 'CONTACT@EXAMPLE.ORG',
    anneeScolaire: '2026-2027',
  });
const schoolPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('HTTP MongoDB établissement : singleton, sauvegarde, fusion et contrôle des versions', async () => {
  assert.equal((await api('GET', '/etablissement')).body, null);
  assert.deepEqual((await api('GET', '/etablissement/exists')).body, { exists: false });
  const created = await api<Etablissement>('POST', '/etablissement', {
    ...schoolInput(),
    version: 0,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.id, 'school');
  assert.equal(created.body.version, 1);
  assert.equal(created.body.email, 'contact@example.org');
  const updated = await api<Etablissement>('PATCH', '/etablissement', {
    version: created.body.version,
    telephone: '+229 0199999999',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.version, 2);
  assert.equal(updated.body.logo, null);
  assert.equal(updated.body.createdAt, created.body.createdAt);
  assert.equal(
    (await api('PATCH', '/etablissement', { version: 1, nom: 'Périmé' })).status,
    409,
  );
  assert.equal(
    (await api('PUT', '/etablissement', { ...schoolInput(), version: 0 })).status,
    409,
  );
});
test('HTTP MongoDB établissement : lecture, remplacement et suppression des images', async () =>
  withMediaStore(async () => {
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    for (const kind of ['logo', 'enTeteCarte']) {
      const uploaded = await imageRequest(
        '/etablissement/images/' + kind,
        randomUUID(),
        0,
      );
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
      assert.deepEqual((await api('GET', '/etablissement/images/' + kind)).body, {
        image: schoolPng,
        revision: 1,
      });
      assert.equal(
        (
          await api('DELETE', '/etablissement/images/' + kind, {
            operationId: randomUUID(),
            revision: 1,
          })
        ).status,
        200,
      );
      assert.deepEqual((await api('GET', '/etablissement/images/' + kind)).body, {
        image: null,
        revision: 2,
      });
    }
    assert.equal(
      (
        await api('PUT', '/etablissement/images/logo', {
          version: 1,
          image: 'https://example.org/logo.png',
        })
      ).status,
      400,
    );
    assert.equal((await api('GET', '/etablissement/images/autre')).status, 400);
  }));
test('HTTP MongoDB établissement : suppression logique, reconfiguration et données scolaires préservées', async () => {
  await setup();
  const created = (
    await api<Etablissement>('POST', '/etablissement', { ...schoolInput(), version: 0 })
  ).body;
  const count = await mongoose.connection.db!.collection('classes').countDocuments();
  assert.equal(
    (
      await api('DELETE', '/etablissement/batch', {
        ids: ['school', 'autre'],
        version: created.version,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api('DELETE', '/etablissement/batch', {
        ids: ['school'],
        version: created.version,
      })
    ).status,
    200,
  );
  assert.equal((await api('GET', '/etablissement')).body, null);
  assert.deepEqual((await api('GET', '/etablissement/exists')).body, { exists: false });
  assert.equal(
    await mongoose.connection.db!.collection('classes').countDocuments(),
    count,
  );
  const state = (await api<{ version: number }>('GET', '/etablissement/state')).body;
  const restored = await api<Etablissement>('PUT', '/etablissement', {
    ...schoolInput(),
    nom: 'Nom reconfiguré',
    version: state.version,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.id, created.id);
  assert.equal(restored.body.createdAt, created.createdAt);
  assert.equal(
    await mongoose.connection.db!.collection('etablissement').countDocuments(),
    1,
  );
  assert.equal(
    (await api('DELETE', '/etablissement', { version: restored.body.version })).status,
    200,
  );
});
test('HTTP MongoDB établissement : deux créations concurrentes ne s’écrasent pas', async () => {
  const responses = await Promise.all([
    api('POST', '/etablissement', { ...schoolInput(), version: 0 }),
    api('POST', '/etablissement', { ...schoolInput(), nom: 'Concurrent', version: 0 }),
  ]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
  assert.equal(
    await mongoose.connection.db!.collection('etablissement').countDocuments(),
    1,
  );
});
test('HTTP MongoDB établissement : champs arbitraires, images invalides et années incohérentes refusés sans écriture', async () => {
  for (const patch of [
    { id: 'autre' },
    { anneeScolaire: '2026-2029' },
    { logo: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { email: 'invalide' },
  ]) {
    assert.equal(
      (await api('POST', '/etablissement', { ...schoolInput(), ...patch, version: 0 }))
        .status,
      400,
    );
  }
  assert.equal((await api('GET', '/etablissement')).body, null);
  assert.equal(
    (await api('PATCH', '/etablissement', { version: 0, nom: 'Absent' })).status,
    404,
  );
  const unauthenticated = await fetch(baseUrl + '/etablissement');
  assert.equal(unauthenticated.status, 401);
});
const databaseName = `cpeg_api_test_${randomUUID().replaceAll('-', '')}`;

before(
  async () => {
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.OFFLINE_AUTH_PRIVATE_KEY = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const systemBinary =
      process.env.MONGOMS_SYSTEM_BINARY ??
      resolve('node_modules/.cache/mongodb-binaries/mongod-7.0.14.exe');
    assert.ok(
      existsSync(systemBinary),
      'Définissez MONGOMS_SYSTEM_BINARY vers un exécutable MongoDB 7.0. Aucun téléchargement automatique volumineux n’est lancé par ces tests.',
    );
    replica = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 60000 }],
      binary: { version: '7.0.14', systemBinary },
      replSet: { count: 1, storageEngine: 'wiredTiger', spawn: { windowsHide: true } },
    });
    await mongoose.connect(replica.getUri(databaseName));
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  },
  { timeout: 120_000 },
);

beforeEach(async () => {
  // Garde explicite : ne jamais vider une base extérieure à ce test isolé.
  assert.equal(mongoose.connection.name, databaseName);
  for (const collection of await mongoose.connection.db!.collections())
    await collection.deleteMany({});
  const user = await User.create({
    username: 'Test Admin',
    email: 'admin@example.invalid',
    password: 'test-password-only',
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await mongoose.disconnect();
  await replica?.stop();
});

async function api<T = Entity>(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    signal: AbortSignal.timeout(15000),
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function create(path: string, body: unknown) {
  const response = await api('POST', path, body);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function setup() {
  const parent = await create('/niveaux-scolaires', {
    nom: 'Secondaire',
    notePlafond: 20,
  });
  const cycle = await create('/cycles', { nom: 'Cycle', niveauScolaireId: parent.id });
  const niveau = await create('/niveaux-classes', { nom: 'Sixième', cycleId: cycle.id });
  const first = await create('/classes', {
    nom: '6e A',
    niveauClasseId: niveau.id,
    effectifF: 10,
    effectifM: 12,
  });
  const second = await create('/classes', {
    nom: '6e B',
    niveauClasseId: niveau.id,
    effectifF: 0,
    effectifM: 0,
  });
  const studentInput = {
    nom: 'Dossou',
    prenom: 'Émilie',
    dateNaissance: '2012-01-01',
    sexe: 'F',
    matricule: 'ML-001',
  };
  const student = await create('/students', studentInput);
  const input = {
    eleveDataId: student.id,
    classeId: first.id,
    anneeScolaire: '2024-2025',
    dateInscription: '2024-09-01',
    statutScolaire: 'nouveau',
    isActive: true,
  };
  return { parent, cycle, niveau, first, second, student, studentInput, input };
}

test('HTTP élèves : naissance et sexe inconnus, inscription, effectif total et complément ultérieur', async () => {
  const { first, input, studentInput } = await setup();
  const created = await api<Entity & { dateNaissance: string; sexe: string }>(
    'POST',
    '/students',
    { ...studentInput, matricule: 'INCOMPLET', dateNaissance: '', sexe: '' },
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.dateNaissance, '');
  assert.equal(created.body.sexe, '');
  assert.equal(
    (await api('POST', '/inscriptions', { ...input, eleveDataId: created.body.id }))
      .status,
    201,
  );
  const classes = await api<
    Array<
      Entity & {
        effectifTotalInscrits: number;
        effectifFInscrits: number;
        effectifMInscrits: number;
      }
    >
  >('GET', '/classes');
  const classe = classes.body.find((row) => row.id === first.id)!;
  assert.equal(classe.effectifTotalInscrits, 1);
  assert.equal(classe.effectifFInscrits, 0);
  assert.equal(classe.effectifMInscrits, 0);
  const updated = await api<Entity & { dateNaissance: string; sexe: string }>(
    'PUT',
    '/students/' + created.body.id,
    { ...studentInput, matricule: 'INCOMPLET', version: created.body.version },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.dateNaissance, studentInput.dateNaissance);
  assert.equal(updated.body.sexe, 'F');
});

interface SyncResult {
  operationId: string;
  items: {
    localId: string;
    record: { id: string; version: number; nom: string; isDeleted: boolean } | null;
  }[];
}

interface CycleSyncResult {
  operationId: string;
  items: {
    localId: string;
    record: {
      id: string;
      version: number;
      nom: string;
      niveauScolaireId: string;
      isDeleted: boolean;
    } | null;
  }[];
}

interface NiveauClasseSyncResult {
  operationId: string;
  items: {
    localId: string;
    record: {
      id: string;
      version: number;
      nom: string;
      cycleId: string;
      niveauScolaireId: string;
      isDeleted: boolean;
    } | null;
  }[];
}

test('HTTP sync classes : transaction métier composée et acquittement atomique', async () => {
  const { niveau } = await setup();
  const request = {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        version: 0,
        action: 'save',
        data: {
          nom: 'Classe valide',
          niveauClasseId: niveau.id,
          effectifF: 0,
          effectifM: 0,
        },
      },
      {
        localId: randomUUID(),
        version: 0,
        action: 'save',
        data: {
          nom: 'Parent absent',
          niveauClasseId: new mongoose.Types.ObjectId().toString(),
          effectifF: 0,
          effectifM: 0,
        },
      },
    ],
  };
  assert.equal((await api('POST', '/classes/sync', request)).status, 409);
  assert.equal(
    await mongoose.connection
      .db!.collection('classes')
      .countDocuments({ nom: 'Classe valide' }),
    0,
  );
  assert.equal(
    await mongoose.connection.db!.collection('entitySyncReceipts').countDocuments(),
    0,
  );
  request.items.splice(1);
  const saved = await api<SyncResult>('POST', '/classes/sync', request);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual((await api('POST', '/classes/sync', request)).body, saved.body);
  assert.equal(
    await mongoose.connection
      .db!.collection('classes')
      .countDocuments({ nom: 'Classe valide' }),
    1,
  );
});

test('HTTP sync classes : scénario frontend IndexedDB vers API MongoDB réel isolé', async () => {
  const payload = jwt.decode(token) as { id: string };
  const result = await promisify(execFile)(
    process.execPath,
    [
      resolve('node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve('../frontend/tsconfig.json'),
      resolve('../frontend/tests/helpers/fullSyncScenario.ts'),
    ],
    {
      env: {
        ...process.env,
        SYNC_TEST_URL: baseUrl,
        SYNC_TEST_TOKEN: token,
        SYNC_TEST_USER: payload.id,
      },
      timeout: 90000,
    },
  );
  assert.ok(result.stdout.includes('validées'), result.stdout + result.stderr);
});
async function levelSyncParent(suffix = '') {
  const school = await create('/niveaux-scolaires', {
    nom: `Secondaire ${suffix}`,
    notePlafond: 20,
  });
  const cycle = await create('/cycles', {
    nom: 'Premier cycle',
    niveauScolaireId: school.id,
  });
  return { school, cycle };
}

async function runFrontendSyncStage(stage: string) {
  const payload = jwt.decode(token) as { id: string };
  const result = await promisify(execFile)(
    process.execPath,
    [
      resolve('node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve('../frontend/tsconfig.json'),
      resolve(
        stage === 'access'
          ? '../frontend/tests/helpers/accessScenario.ts'
          : '../frontend/tests/helpers/fullSyncScenario.ts',
      ),
    ],
    {
      env: {
        ...process.env,
        SYNC_TEST_URL: baseUrl,
        SYNC_TEST_TOKEN: token,
        SYNC_TEST_USER: payload.id,
        SYNC_TEST_STAGE: stage,
      },
      timeout: 90000,
    },
  );
  return result.stdout;
}

test('HTTP accès : autorisation signée utilisable par le frontend hors connexion', async () => {
  assert.ok((await runFrontendSyncStage('access')).includes('Accès signé :'));
});

test('HTTP accès : enseignants et élèves reconnus sans accès aux modules administrateurs', async () => {
  for (const role of ['teacher', 'student']) {
    await User.updateOne({ email: 'admin@example.invalid' }, { $set: { role } });
    const logged = await api<{ token: string; user: { role: string } }>(
      'POST',
      '/auth/login',
      { email: 'admin@example.invalid', password: 'test-password-only' },
    );
    assert.equal(logged.status, 200);
    assert.equal(logged.body.user.role, role);
    assert.equal((await api('GET', '/auth/me')).status, 200);
    for (const path of [
      '/students',
      '/notes/sync',
      '/inscriptions',
      '/media/school/school/logo',
    ])
      assert.equal((await api('GET', path)).status, 403);
    const offline = await api<{ grant: string }>('POST', '/auth/offline-access');
    assert.equal(offline.status, 200);
    const unauthorized = await fetch(baseUrl + '/auth/me', {
      headers: { Authorization: `Bearer ${offline.body.grant}` },
    });
    assert.equal(
      unauthorized.status,
      401,
      'Une autorisation hors connexion ne doit pas servir de jeton cloud.',
    );
  }
  await User.updateOne(
    { email: 'admin@example.invalid' },
    { $set: { status: 'inactive' } },
  );
  assert.equal((await api('GET', '/auth/me')).status, 401);
  assert.equal((await api('POST', '/auth/offline-access')).status, 401);
});

test('HTTP sync paramètres : identité, configuration, archive et second poste', async () => {
  assert.ok(
    (await runFrontendSyncStage('settings')).includes('Synchronisation paramètres :'),
  );
});

test('HTTP sync globale : dépendances, lectures uniques et ordre des suppressions', async () => {
  assert.ok(
    (await runFrontendSyncStage('coordinator')).includes('Synchronisation globale :'),
  );
});

test('HTTP sync bulletins : calcul serveur, conflits et restauration', async () => {
  assert.ok(
    (await runFrontendSyncStage('bulletin')).includes('Synchronisation bulletins :'),
  );
});

test('HTTP sync notes : scénario frontend du zéro, import, clôture et suppression', async () => {
  assert.ok((await runFrontendSyncStage('note')).includes('Synchronisation notes :'));
});

test('HTTP sync inscriptions : scénario frontend des actions et transferts successifs', async () => {
  assert.ok(
    (await runFrontendSyncStage('inscription')).includes(
      'Synchronisation inscriptions :',
    ),
  );
});

test('HTTP sync inscriptions : une destination invalide annule la désactivation source', async () => {
  const { input } = await setup();
  const inscription = await create('/inscriptions', input);
  const result = await api('POST', '/inscriptions/sync', {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        targetId: inscription.id,
        version: inscription.version,
        action: 'save',
        data: { ...input, isActive: false },
      },
      {
        localId: randomUUID(),
        version: 0,
        action: 'save',
        data: {
          ...input,
          classeId: new mongoose.Types.ObjectId().toString(),
          statutScolaire: 'transfert',
          isActive: true,
        },
      },
    ],
  });
  assert.equal(result.status, 409);
  const source = await api<{ isActive: boolean; version: number }>(
    'GET',
    `/inscriptions/${inscription.id}`,
  );
  assert.equal(source.body.isActive, true);
  assert.equal(source.body.version, inscription.version);
  assert.equal(
    await mongoose.connection.db!.collection('entitySyncReceipts').countDocuments(),
    0,
  );
});

test('HTTP sync évaluations : scénario frontend avec modèles globaux et par période', async () => {
  assert.ok(
    (await runFrontendSyncStage('evaluation')).includes('Synchronisation évaluations :'),
  );
});

test('HTTP sync enseignants : scénario frontend avec affectations et suppressions', async () => {
  assert.ok(
    (await runFrontendSyncStage('teacher')).includes('Synchronisation enseignants :'),
  );
});

test('HTTP sync matières : scénario frontend avec coefficient et suppression multiple', async () => {
  assert.ok(
    (await runFrontendSyncStage('matiere')).includes('Synchronisation matières :'),
  );
});

test('HTTP sync périodes : scénario frontend avec portée globale et niveau scolaire', async () => {
  const payload = jwt.decode(token) as { id: string };
  const result = await promisify(execFile)(
    process.execPath,
    [
      resolve('node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve('../frontend/tsconfig.json'),
      resolve('../frontend/tests/helpers/fullSyncScenario.ts'),
    ],
    {
      env: {
        ...process.env,
        SYNC_TEST_URL: baseUrl,
        SYNC_TEST_TOKEN: token,
        SYNC_TEST_USER: payload.id,
        SYNC_TEST_STAGE: 'periode',
      },
      timeout: 90000,
    },
  );
  assert.ok(
    result.stdout.includes('périodes :') && result.stdout.includes('validées'),
    result.stdout + result.stderr,
  );
});

test('HTTP sync élèves : scénario frontend complet avec homonymes, conflit et suppression multiple', async () => {
  const payload = jwt.decode(token) as { id: string };
  const result = await promisify(execFile)(
    process.execPath,
    [
      resolve('node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve('../frontend/tsconfig.json'),
      resolve('../frontend/tests/helpers/fullSyncScenario.ts'),
    ],
    {
      env: {
        ...process.env,
        SYNC_TEST_URL: baseUrl,
        SYNC_TEST_TOKEN: token,
        SYNC_TEST_USER: payload.id,
        SYNC_TEST_STAGE: 'student',
      },
      timeout: 90000,
    },
  );
  assert.ok(
    result.stdout.includes('élèves :') && result.stdout.includes('validées'),
    result.stdout + result.stderr,
  );
});

test('HTTP sync niveaux de classe : création concurrente, hiérarchie déduite et acquittement unique', async () => {
  const { school, cycle } = await levelSyncParent();
  const request = {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        action: 'save',
        version: 0,
        data: { nom: 'Sixième', cycleId: cycle.id },
      },
    ],
  };
  const [a, b] = await Promise.all([
    api<NiveauClasseSyncResult>('POST', '/niveaux-classes/sync', request),
    api<NiveauClasseSyncResult>('POST', '/niveaux-classes/sync', request),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a, b);
  assert.equal(a.body.items[0].record?.cycleId, cycle.id);
  assert.equal(a.body.items[0].record?.niveauScolaireId, school.id);
  assert.equal(
    await mongoose.connection.db!.collection('niveauclasses').countDocuments(),
    1,
  );
  request.items[0].data.nom = 'Autre';
  assert.equal((await api('POST', '/niveaux-classes/sync', request)).status, 409);
});

test('HTTP sync niveaux de classe : version exacte, parent fixe et archive non restaurée', async () => {
  const { cycle } = await levelSyncParent();
  const other = await levelSyncParent('autre');
  const level = await create('/niveaux-classes', { nom: 'Sixième', cycleId: cycle.id });
  const item = {
    localId: randomUUID(),
    targetId: level.id,
    version: level.version,
    action: 'save',
    data: { nom: 'Sixième modifiée', cycleId: cycle.id },
  };
  assert.equal(
    (
      await api('POST', '/niveaux-classes/sync', {
        operationId: randomUUID(),
        items: [{ ...item, data: { ...item.data, cycleId: other.cycle.id } }],
      })
    ).status,
    409,
  );
  const saved = await api<NiveauClasseSyncResult>('POST', '/niveaux-classes/sync', {
    operationId: randomUUID(),
    items: [item],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.items[0].record?.version, level.version + 1);
  assert.equal(
    (
      await api('POST', '/niveaux-classes/sync', {
        operationId: randomUUID(),
        items: [item],
      })
    ).status,
    409,
  );
  const removed = await api<NiveauClasseSyncResult>('POST', '/niveaux-classes/sync', {
    operationId: randomUUID(),
    items: [{ ...item, action: 'delete', version: saved.body.items[0].record!.version }],
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (
      await api('POST', '/niveaux-classes/sync', {
        operationId: randomUUID(),
        items: [{ ...item, version: removed.body.items[0].record!.version }],
      })
    ).status,
    409,
  );
});

test('HTTP sync niveaux de classe : suppression multiple atomique protège classes et matières', async () => {
  const { cycle } = await levelSyncParent();
  const a = await create('/niveaux-classes', { nom: 'Sixième', cycleId: cycle.id });
  const b = await create('/niveaux-classes', { nom: 'Cinquième', cycleId: cycle.id });
  const child = await create('/classes', {
    nom: '5e A',
    niveauClasseId: b.id,
    effectifF: 0,
    effectifM: 0,
  });
  const request = {
    operationId: randomUUID(),
    items: [a, b].map((record) => ({
      localId: randomUUID(),
      targetId: record.id,
      version: record.version,
      action: 'delete',
    })),
  };
  assert.equal((await api('POST', '/niveaux-classes/sync', request)).status, 409);
  assert.equal((await api('GET', `/niveaux-classes/${a.id}`)).status, 200);
  assert.equal(
    await mongoose.connection.db!.collection('niveauClasseSyncReceipts').countDocuments(),
    0,
  );
  await api('DELETE', `/classes/${child.id}`);
  const subject = await create('/matieres', {
    nom: 'Mathématiques',
    coefficient: 1,
    niveauClasseId: b.id,
  });
  assert.equal((await api('POST', '/niveaux-classes/sync', request)).status, 409);
  await api('DELETE', `/matieres/${subject.id}`);
  const removed = await api<NiveauClasseSyncResult>(
    'POST',
    '/niveaux-classes/sync',
    request,
  );
  assert.equal(removed.status, 200);
  assert.ok(removed.body.items.every((item) => item.record?.isDeleted));
  assert.deepEqual(
    (await api('POST', '/niveaux-classes/sync', request)).body,
    removed.body,
  );
});

test('HTTP sync niveaux de classe : noms par cycle et accusé réservé à son auteur', async () => {
  const a = await levelSyncParent('A');
  const b = await levelSyncParent('B');
  const request = {
    operationId: randomUUID(),
    items: [a.cycle, b.cycle].map((cycle) => ({
      localId: randomUUID(),
      action: 'save',
      version: 0,
      data: { nom: 'Sixième', cycleId: cycle.id },
    })),
  };
  assert.equal((await api('POST', '/niveaux-classes/sync', request)).status, 200);
  assert.equal(
    (
      await api('POST', '/niveaux-classes/sync', {
        operationId: randomUUID(),
        items: [request.items[0]],
      })
    ).status,
    409,
  );
  const previous = token;
  const user = await User.create({
    username: 'Autre',
    email: 'other-level@example.invalid',
    password: 'test-password-only',
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  try {
    assert.equal((await api('POST', '/niveaux-classes/sync', request)).status, 409);
  } finally {
    token = previous;
  }
});

test('HTTP sync niveaux de classe : pages, archives et hiérarchie fournie par le client refusée', async () => {
  const { school, cycle } = await levelSyncParent();
  await mongoose.connection.db!.collection('niveauclasses').insertMany(
    Array.from({ length: 102 }, (_, index) => ({
      nom: `Niveau ${index}`,
      cycleId: new mongoose.Types.ObjectId(cycle.id),
      niveauScolaireId: new mongoose.Types.ObjectId(school.id),
      __v: 0,
      isDeleted: index === 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  const a = await api<{ items: { id: string; isDeleted: boolean }[]; next: string }>(
    'GET',
    '/niveaux-classes/sync',
  );
  assert.equal(a.status, 200);
  assert.equal(a.body.items.length, 100);
  assert.ok(a.body.items.some((item) => item.isDeleted));
  const b = await api<{ items: { id: string }[]; next: null }>(
    'GET',
    `/niveaux-classes/sync?after=${a.body.next}`,
  );
  assert.equal(b.body.items.length, 2);
  assert.equal(b.body.next, null);
  assert.equal(
    new Set([...a.body.items, ...b.body.items].map((item) => item.id)).size,
    102,
  );
  const item = {
    localId: randomUUID(),
    version: 0,
    action: 'save',
    data: { nom: 'Invalide', cycleId: cycle.id, niveauScolaireId: school.id },
  };
  assert.equal(
    (
      await api('POST', '/niveaux-classes/sync', {
        operationId: randomUUID(),
        items: [item],
      })
    ).status,
    400,
  );
  assert.equal((await api('GET', '/niveaux-classes/sync?after=invalid')).status, 400);
  assert.equal(
    (
      await api('POST', '/niveaux-classes/sync', {
        operationId: randomUUID(),
        items: [
          {
            ...item,
            data: { nom: 'Invalide', cycleId: new mongoose.Types.ObjectId().toString() },
          },
        ],
      })
    ).status,
    409,
  );
});

test('HTTP sync niveaux de classe : création concurrente à suppression du cycle sans orphelin', async () => {
  for (const mode of ['sync', 'classique']) {
    const { cycle } = await levelSyncParent(mode);
    const data = { nom: 'Sixième', cycleId: cycle.id };
    const creation =
      mode === 'sync'
        ? api('POST', '/niveaux-classes/sync', {
            operationId: randomUUID(),
            items: [{ localId: randomUUID(), version: 0, action: 'save', data }],
          })
        : api('POST', '/niveaux-classes', data);
    const results = await Promise.all([creation, api('DELETE', `/cycles/${cycle.id}`)]);
    assert.ok(results.every((result) => [200, 201, 404, 409].includes(result.status)));
    const stored = await mongoose.connection
      .db!.collection('cycles')
      .findOne({ _id: new mongoose.Types.ObjectId(cycle.id) });
    const count = await mongoose.connection
      .db!.collection('niveauclasses')
      .countDocuments({
        cycleId: new mongoose.Types.ObjectId(cycle.id),
        isDeleted: false,
      });
    assert.ok(!stored?.isDeleted || count === 0);
    assert.ok(results[0].status >= 400 || results[1].status >= 400);
  }
});

test('HTTP sync niveaux de classe : création de classe concurrente à suppression sans orphelin', async () => {
  const { cycle } = await levelSyncParent();
  const level = await create('/niveaux-classes', { nom: 'Sixième', cycleId: cycle.id });
  const results = await Promise.all([
    api('POST', '/classes', {
      nom: '6e A',
      niveauClasseId: level.id,
      effectifF: 0,
      effectifM: 0,
    }),
    api('POST', '/niveaux-classes/sync', {
      operationId: randomUUID(),
      items: [
        {
          localId: randomUUID(),
          targetId: level.id,
          version: level.version,
          action: 'delete',
        },
      ],
    }),
  ]);
  assert.ok(results.every((result) => [200, 201, 404, 409].includes(result.status)));
  const stored = await mongoose.connection
    .db!.collection('niveauclasses')
    .findOne({ _id: new mongoose.Types.ObjectId(level.id) });
  const count = await mongoose.connection.db!.collection('classes').countDocuments({
    niveauClasseId: new mongoose.Types.ObjectId(level.id),
    isDeleted: false,
  });
  assert.ok(!stored?.isDeleted || count === 0);
  assert.ok(results[0].status >= 400 || results[1].status >= 400);
});

test('HTTP sync cycles : création liée au parent et reprise concurrente sans doublon', async () => {
  const parent = await create('/niveaux-scolaires', {
    nom: 'Secondaire',
    notePlafond: 20,
  });
  const request = {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        action: 'save',
        version: 0,
        data: { nom: 'Premier cycle', niveauScolaireId: parent.id },
      },
    ],
  };
  const [a, b] = await Promise.all([
    api<CycleSyncResult>('POST', '/cycles/sync', request),
    api<CycleSyncResult>('POST', '/cycles/sync', request),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a, b);
  assert.equal(a.body.items[0].record?.niveauScolaireId, parent.id);
  assert.equal(await mongoose.connection.db!.collection('cycles').countDocuments(), 1);
  request.items[0].data.nom = 'Autre cycle';
  assert.equal((await api('POST', '/cycles/sync', request)).status, 409);
});

test('HTTP sync cycles : version, rattachement fixe et archives protégés', async () => {
  const parent = await create('/niveaux-scolaires', {
    nom: 'Secondaire',
    notePlafond: 20,
  });
  const other = await create('/niveaux-scolaires', { nom: 'Primaire', notePlafond: 20 });
  const cycle = await create('/cycles', { nom: 'Cycle', niveauScolaireId: parent.id });
  const item = {
    localId: randomUUID(),
    targetId: cycle.id,
    action: 'save',
    version: cycle.version,
    data: { nom: 'Cycle modifié', niveauScolaireId: parent.id },
  };
  assert.equal(
    (
      await api('POST', '/cycles/sync', {
        operationId: randomUUID(),
        items: [{ ...item, data: { ...item.data, niveauScolaireId: other.id } }],
      })
    ).status,
    409,
  );
  const updated = await api<CycleSyncResult>('POST', '/cycles/sync', {
    operationId: randomUUID(),
    items: [item],
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (await api('POST', '/cycles/sync', { operationId: randomUUID(), items: [item] }))
      .status,
    409,
  );
  const removed = await api<CycleSyncResult>('POST', '/cycles/sync', {
    operationId: randomUUID(),
    items: [
      { ...item, action: 'delete', version: updated.body.items[0].record!.version },
    ],
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (
      await api('POST', '/cycles/sync', {
        operationId: randomUUID(),
        items: [{ ...item, version: removed.body.items[0].record!.version }],
      })
    ).status,
    409,
  );
});

test('HTTP sync cycles : lot de suppression atomique et dépendances conservées', async () => {
  const parent = await create('/niveaux-scolaires', {
    nom: 'Secondaire',
    notePlafond: 20,
  });
  const a = await create('/cycles', { nom: 'Premier', niveauScolaireId: parent.id });
  const b = await create('/cycles', { nom: 'Second', niveauScolaireId: parent.id });
  const child = await create('/niveaux-classes', { nom: 'Sixième', cycleId: b.id });
  const request = {
    operationId: randomUUID(),
    items: [a, b].map((record) => ({
      localId: randomUUID(),
      targetId: record.id,
      version: record.version,
      action: 'delete',
    })),
  };
  assert.equal((await api('POST', '/cycles/sync', request)).status, 409);
  assert.equal((await api('GET', `/cycles/${a.id}`)).status, 200);
  assert.equal(
    await mongoose.connection.db!.collection('cycleSyncReceipts').countDocuments(),
    0,
  );
  await api('DELETE', `/niveaux-classes/${child.id}`);
  const removed = await api<CycleSyncResult>('POST', '/cycles/sync', request);
  assert.equal(removed.status, 200);
  assert.ok(removed.body.items.every((item) => item.record?.isDeleted));
  assert.deepEqual((await api('POST', '/cycles/sync', request)).body, removed.body);
});

test('HTTP sync cycles : unicité par niveau et propriétaire des accusés', async () => {
  const a = await create('/niveaux-scolaires', { nom: 'Primaire', notePlafond: 20 });
  const b = await create('/niveaux-scolaires', { nom: 'Secondaire', notePlafond: 20 });
  const request = {
    operationId: randomUUID(),
    items: [a, b].map((parent) => ({
      localId: randomUUID(),
      action: 'save',
      version: 0,
      data: { nom: 'Cycle', niveauScolaireId: parent.id },
    })),
  };
  assert.equal((await api('POST', '/cycles/sync', request)).status, 200);
  assert.equal(
    (
      await api('POST', '/cycles/sync', {
        operationId: randomUUID(),
        items: [request.items[0]],
      })
    ).status,
    409,
  );
  const previous = token;
  const user = await User.create({
    username: 'Autre',
    email: 'other-cycle@example.invalid',
    password: 'test-password-only',
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  try {
    assert.equal((await api('POST', '/cycles/sync', request)).status, 409);
  } finally {
    token = previous;
  }
});

test('HTTP sync cycles : pagination des archives et contrats invalides refusés', async () => {
  const parent = await create('/niveaux-scolaires', {
    nom: 'Secondaire',
    notePlafond: 20,
  });
  await mongoose.connection.db!.collection('cycles').insertMany(
    Array.from({ length: 102 }, (_, index) => ({
      nom: `Cycle ${index}`,
      niveauScolaireId: new mongoose.Types.ObjectId(parent.id),
      __v: 0,
      isDeleted: index === 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  const a = await api<{ items: { id: string; isDeleted: boolean }[]; next: string }>(
    'GET',
    '/cycles/sync',
  );
  assert.equal(a.status, 200);
  assert.equal(a.body.items.length, 100);
  assert.ok(a.body.items.some((item) => item.isDeleted));
  const b = await api<{ items: { id: string }[]; next: null }>(
    'GET',
    `/cycles/sync?after=${a.body.next}`,
  );
  assert.equal(b.body.items.length, 2);
  assert.equal(b.body.next, null);
  assert.equal(
    new Set([...a.body.items, ...b.body.items].map((item) => item.id)).size,
    102,
  );
  const item = {
    localId: randomUUID(),
    version: 0,
    action: 'save',
    data: { nom: 'Invalide', niveauScolaireId: 'uuid-local' },
  };
  assert.equal(
    (await api('POST', '/cycles/sync', { operationId: randomUUID(), items: [item] }))
      .status,
    400,
  );
  assert.equal(
    (
      await api('POST', '/cycles/sync', {
        operationId: randomUUID(),
        items: [
          {
            ...item,
            data: {
              ...item.data,
              niveauScolaireId: new mongoose.Types.ObjectId().toString(),
            },
          },
        ],
      })
    ).status,
    409,
  );
  assert.equal((await api('GET', '/cycles/sync?after=invalid')).status, 400);
});

test('HTTP sync cycles : création concurrente à la suppression du parent sans cycle orphelin', async () => {
  for (const mode of ['sync', 'classique']) {
    const parent = await create('/niveaux-scolaires', {
      nom: `Parent ${mode}`,
      notePlafond: 20,
    });
    const data = { nom: 'Cycle', niveauScolaireId: parent.id };
    const creation =
      mode === 'sync'
        ? api('POST', '/cycles/sync', {
            operationId: randomUUID(),
            items: [{ localId: randomUUID(), version: 0, action: 'save', data }],
          })
        : api('POST', '/cycles', data);
    const results = await Promise.all([
      creation,
      api('DELETE', `/niveaux-scolaires/${parent.id}`),
    ]);
    assert.ok(results.every((result) => [200, 201, 404, 409].includes(result.status)));
    const stored = await mongoose.connection
      .db!.collection('niveauscolaires')
      .findOne({ _id: new mongoose.Types.ObjectId(parent.id) });
    const count = await mongoose.connection.db!.collection('cycles').countDocuments({
      niveauScolaireId: new mongoose.Types.ObjectId(parent.id),
      isDeleted: false,
    });
    assert.ok(
      !stored?.isDeleted || count === 0,
      'Un cycle actif ne doit pas référencer un niveau supprimé.',
    );
    assert.ok(results[0].status >= 400 || results[1].status >= 400);
  }
});

test('HTTP sync niveaux : création acquittée une seule fois et UUID lié au contenu', async () => {
  const request = {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        action: 'save',
        version: 0,
        data: { nom: 'Secondaire', notePlafond: 20 },
      },
    ],
  };
  const first = await api<SyncResult>('POST', '/niveaux-scolaires/sync', request);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const replay = await api('POST', '/niveaux-scolaires/sync', request);
  assert.deepEqual(replay.body, first.body);
  assert.equal(
    await mongoose.connection.db!.collection('niveauscolaires').countDocuments(),
    1,
  );
  request.items[0].data.nom = 'Primaire';
  assert.equal((await api('POST', '/niveaux-scolaires/sync', request)).status, 409);
});

test('HTTP sync niveaux : concurrence du même UUID et conflit de version sans écrasement', async () => {
  const request = {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        action: 'save',
        version: 0,
        data: { nom: 'Secondaire', notePlafond: 20 },
      },
    ],
  };
  const results = await Promise.all([
    api<SyncResult>('POST', '/niveaux-scolaires/sync', request),
    api<SyncResult>('POST', '/niveaux-scolaires/sync', request),
  ]);
  assert.equal(results[0].status, 200);
  assert.deepEqual(results[0], results[1]);
  const record = results[0].body.items[0].record!;
  const item = {
    localId: request.items[0].localId,
    targetId: record.id,
    version: record.version,
    action: 'save',
    data: { nom: 'Secondaire modifié', notePlafond: 10 },
  };
  assert.equal(
    (
      await api('POST', '/niveaux-scolaires/sync', {
        operationId: randomUUID(),
        items: [item],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api('POST', '/niveaux-scolaires/sync', {
        operationId: randomUUID(),
        items: [{ ...item, data: { nom: 'Écrasement', notePlafond: 30 } }],
      })
    ).status,
    409,
  );
  const current = await api<{ nom: string; notePlafond: number }>(
    'GET',
    `/niveaux-scolaires/${record.id}`,
  );
  assert.equal(current.body.nom, 'Secondaire modifié');
  assert.equal(current.body.notePlafond, 10);
});

test('HTTP sync niveaux : suppression multiple atomique, dépendances et acquittement rejouable', async () => {
  const first = await create('/niveaux-scolaires', { nom: 'Premier', notePlafond: 20 });
  const second = await create('/niveaux-scolaires', { nom: 'Second', notePlafond: 20 });
  const cycle = await create('/cycles', { nom: 'Cycle', niveauScolaireId: second.id });
  const request = {
    operationId: randomUUID(),
    items: [first, second].map((record) => ({
      localId: randomUUID(),
      targetId: record.id,
      version: record.version,
      action: 'delete',
    })),
  };
  assert.equal((await api('POST', '/niveaux-scolaires/sync', request)).status, 409);
  assert.equal((await api('GET', `/niveaux-scolaires/${first.id}`)).status, 200);
  assert.equal(
    await mongoose.connection.db!.collection('niveauSyncReceipts').countDocuments(),
    0,
  );
  await api('DELETE', `/cycles/${cycle.id}`);
  const removed = await api<SyncResult>('POST', '/niveaux-scolaires/sync', request);
  assert.equal(removed.status, 200);
  assert.ok(removed.body.items.every((item) => item.record?.isDeleted));
  assert.deepEqual(
    (await api('POST', '/niveaux-scolaires/sync', request)).body,
    removed.body,
  );
});

test('HTTP sync niveaux : pagination inclut les archives et validation du lot', async () => {
  const collection = mongoose.connection.db!.collection('niveauscolaires');
  await collection.insertMany(
    Array.from({ length: 102 }, (_, index) => ({
      nom: `Niveau ${index}`,
      notePlafond: 20,
      __v: 0,
      isDeleted: index === 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  const first = await api<{ items: { id: string; isDeleted: boolean }[]; next: string }>(
    'GET',
    '/niveaux-scolaires/sync',
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 100);
  assert.ok(first.body.items.some((item) => item.isDeleted));
  const second = await api<{ items: { id: string }[]; next: null }>(
    'GET',
    `/niveaux-scolaires/sync?after=${first.body.next}`,
  );
  assert.equal(second.body.items.length, 2);
  assert.equal(second.body.next, null);
  assert.equal(
    new Set([...first.body.items, ...second.body.items].map((item) => item.id)).size,
    102,
  );
  assert.equal((await api('GET', '/niveaux-scolaires/sync?after=invalid')).status, 400);
  assert.equal(
    (
      await api('POST', '/niveaux-scolaires/sync', {
        operationId: randomUUID(),
        items: [],
      })
    ).status,
    400,
  );
});

test('HTTP sync niveaux : un acquittement ne peut pas être réutilisé par un autre compte', async () => {
  const request = {
    operationId: randomUUID(),
    items: [{ localId: randomUUID(), action: 'delete', version: 0 }],
  };
  assert.equal((await api('POST', '/niveaux-scolaires/sync', request)).status, 200);
  const user = await User.create({
    username: 'Autre',
    email: 'other@example.invalid',
    password: 'test-password-only',
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  const previous = token;
  token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  try {
    assert.equal((await api('POST', '/niveaux-scolaires/sync', request)).status, 409);
  } finally {
    token = previous;
  }
});

test('HTTP MongoDB : réinscription, historique, lectures et compte actif', async () => {
  const { input, student, second } = await setup();
  const old = await create('/inscriptions', input);
  const response = await api<Batch>('POST', '/inscriptions/reenrol', {
    eleveDataIds: [student.id],
    classeId: second.id,
    anneeScolaire: '2025-2026',
    dateInscription: '2025-09-01',
    statutScolaire: 'passant',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.errors.length, 0, JSON.stringify(response.body));
  assert.equal((await api('GET', `/inscriptions/${old.id}`)).body.isActive, false);
  assert.equal(
    (await api<Entity>('GET', `/inscriptions/by-student/${student.id}/current`)).body
      .classeId,
    second.id,
  );
  assert.equal(
    (
      await api<Page>('POST', '/inscriptions/search', {
        where: { recherche: 'emilie' },
        options: { limit: 1 },
      })
    ).body.total,
    2,
  );
  const counts = await api<
    { id: string; effectifTotalInscrits: number; effectifFInscrits: number }[]
  >('GET', '/classes');
  assert.equal(
    counts.body.find((classe) => classe.id === second.id)?.effectifTotalInscrits,
    1,
  );
  assert.equal(
    counts.body.find((classe) => classe.id === second.id)?.effectifFInscrits,
    1,
  );
});

test('HTTP MongoDB : transferts aller-retour sans doublon ni perte historique', async () => {
  const { input, first, second } = await setup();
  const old = await create('/inscriptions', input);
  const moved = await api<Batch>('POST', '/inscriptions/transfer', {
    ids: [old.id],
    classeId: second.id,
    dateInscription: '2024-10-01',
  });
  assert.equal(moved.body.errors.length, 0, JSON.stringify(moved.body));
  const returned = await api<Batch>('POST', '/inscriptions/transfer', {
    ids: [moved.body.success[0].id],
    classeId: first.id,
    dateInscription: '2024-11-01',
  });
  assert.equal(returned.body.errors.length, 0, JSON.stringify(returned.body));
  assert.equal(returned.body.success[0].id, old.id);
  assert.equal((await api<Page>('GET', '/inscriptions/active')).body.total, 1);
});

test('HTTP MongoDB : création combinée annulée si la classe est absente', async () => {
  const { studentInput, first } = await setup();
  const student = { ...studentInput, matricule: 'ML-002' };
  const inscription = {
    classeId: new mongoose.Types.ObjectId().toString(),
    anneeScolaire: '2025-2026',
    dateInscription: '2025-09-01',
  };
  assert.equal(
    (await api('POST', '/inscriptions/new-student', { student, inscription })).status,
    404,
  );
  assert.equal(
    await mongoose.connection
      .db!.collection('elevedatas')
      .countDocuments({ matricule: 'ML-002' }),
    0,
  );
  assert.equal(
    (
      await api('POST', '/inscriptions/new-student', {
        student,
        inscription: { ...inscription, classeId: first.id },
      })
    ).status,
    200,
  );
});

test('HTTP MongoDB : activation/désactivation dédiées et lot avec succès partiel', async () => {
  const { input } = await setup();
  const record = await create('/inscriptions', input);
  assert.equal(
    (await api('PATCH', `/inscriptions/${record.id}/deactivate`)).body.isActive,
    false,
  );
  const report = await api<Batch>('PATCH', '/inscriptions/batch/activate', {
    ids: [record.id, new mongoose.Types.ObjectId().toString()],
  });
  assert.equal(report.body.success.length, 1);
  assert.equal(report.body.errors.length, 1);
});

test('HTTP MongoDB : dépendances et suppression en lot sans effet partiel', async () => {
  const { first, second, input } = await setup();
  const record = await create('/inscriptions', input);
  assert.equal(
    (await api('DELETE', '/classes/batch', { ids: [second.id, first.id] })).status,
    409,
  );
  assert.equal((await api('GET', `/classes/${second.id}`)).status, 200);
  assert.equal(
    (await api('DELETE', '/inscriptions/batch', { ids: [record.id] })).status,
    200,
  );
  assert.equal(
    (await api('DELETE', '/classes/batch', { ids: [second.id, first.id] })).status,
    200,
  );
});

test('HTTP MongoDB : deux inscriptions concurrentes ne laissent qu’une active', async () => {
  const { input, second } = await setup();
  const responses = await Promise.all([
    api('POST', '/inscriptions', input),
    api('POST', '/inscriptions', { ...input, classeId: second.id }),
  ]);
  assert.ok(
    responses.every((response) => response.status === 201),
    JSON.stringify(responses),
  );
  assert.equal((await api<Page>('GET', '/inscriptions/active')).body.total, 1);
});

test('HTTP MongoDB : vie scolaire, conduite zéro et protection du bulletin', async () => {
  const { input, parent } = await setup();
  const record = await create('/inscriptions', input);
  const periodeId = new mongoose.Types.ObjectId();
  await mongoose.connection.db!.collection('periodes').insertOne({
    _id: periodeId,
    nom: 'T1',
    niveauScolaireId: new mongoose.Types.ObjectId(parent.id),
    ordre: 1,
    coefficient: 1,
    isDeleted: false,
  });
  const response = await api('PATCH', `/inscriptions/${record.id}/school-life`, {
    version: record.version,
    vieScolaire: [
      {
        periodeId: periodeId.toString(),
        score: { absences: 2, retards: 1, conduite: 0 },
      },
    ],
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const bulletin = await mongoose.connection
    .db!.collection('bulletins')
    .findOne({ inscriptionId: new mongoose.Types.ObjectId(record.id) });
  assert.equal(bulletin?.vieScolaire.conduite, 0);
  assert.equal((await api('DELETE', `/inscriptions/${record.id}`)).status, 409);
});

test('HTTP MongoDB : créations en lot et consultations ciblées', async () => {
  const { parent, cycle, niveau, student } = await setup();
  const report = await api<Batch>('POST', '/niveaux-scolaires/batch', {
    items: [
      { nom: 'Primaire', notePlafond: 10 },
      { nom: 'Secondaire', notePlafond: 20 },
      { nom: '', notePlafond: 20 },
    ],
  });
  assert.equal(report.body.success.length, 1);
  assert.equal(report.body.errors.length, 2);
  assert.ok(!report.body.errors.some((error) => error.message.includes('E11000')));
  assert.equal((await api('GET', `/niveaux-scolaires/${parent.id}`)).status, 200);
  assert.equal((await api('GET', `/cycles/by-niveau-scolaire/${parent.id}`)).status, 200);
  assert.equal((await api('GET', `/niveaux-classes/by-cycle/${cycle.id}`)).status, 200);
  assert.equal((await api('GET', `/classes/by-niveau-classe/${niveau.id}`)).status, 200);
  assert.equal((await api('GET', '/students/by-matricule/ml-001')).body.id, student.id);
});

test('HTTP MongoDB : accès anonyme refusé et droits vérifiés dans le compte', async () => {
  assert.equal((await fetch(baseUrl + '/inscriptions')).status, 401);
  await User.updateMany({}, { $set: { role: 'teacher' } });
  assert.equal((await api('GET', '/inscriptions')).status, 403);
  await User.updateMany({}, { $set: { role: 'admin', status: 'inactive' } });
  assert.equal((await api('GET', '/inscriptions')).status, 401);
});

test('HTTP MongoDB : périodes, consultations, versions, dates et lot partiel', async () => {
  const { parent } = await setup();
  const input = { nom: 'T1', ordre: 1, coefficient: 1, niveauScolaireId: parent.id };
  const record = await create('/periodes', input);
  assert.equal((await api('GET', '/periodes/' + record.id)).status, 200);
  const report = await api<Batch>('POST', '/periodes/batch', {
    items: [
      input,
      { ...input, nom: 'T2', ordre: 2, dateDebut: '2026-09-01', dateFin: '2026-12-31' },
      { ...input, ordre: 3, coefficient: 0 },
    ],
  });
  assert.equal(report.body.success.length, 1);
  assert.equal(report.body.errors.length, 2);
  const byLevel = await api<unknown[]>(
    'GET',
    '/periodes/by-niveau-scolaire/' + parent.id,
  );
  assert.equal(byLevel.body.length, 2);
  assert.equal(
    (await api<unknown[]>('GET', '/periodes/by-year/2026-2027')).body.length,
    2,
  );
  assert.equal(
    (await api<unknown[]>('GET', '/periodes/by-year/2022-2023')).body.length,
    1,
  );
  assert.equal(
    (
      await api('PUT', '/periodes/' + record.id, {
        ...input,
        nom: 'Renommé',
        version: record.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('PUT', '/periodes/' + record.id, { ...input, version: record.version }))
      .status,
    409,
  );
  assert.equal(
    (
      await api('POST', '/periodes', {
        ...input,
        ordre: 3,
        dateDebut: '2026-02-30',
        dateFin: '2026-03-31',
      })
    ).status,
    400,
  );
  assert.equal((await api('GET', '/periodes/by-year/2026-2029')).status, 400);
});

test('HTTP MongoDB : période utilisée protégée et suppression de lot atomique', async () => {
  const { input, parent } = await setup();
  const inscription = await create('/inscriptions', input);
  const data = { nom: 'T1', ordre: 1, coefficient: 1, niveauScolaireId: parent.id };
  const first = await create('/periodes', data);
  const second = await create('/periodes', { ...data, ordre: 2 });
  const response = await api(
    'PATCH',
    '/inscriptions/' + inscription.id + '/school-life',
    {
      version: inscription.version,
      vieScolaire: [
        { periodeId: first.id, score: { absences: 0, retards: 0, conduite: 0 } },
      ],
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(
    (
      await api('PUT', '/periodes/' + first.id, {
        ...data,
        coefficient: 2,
        version: first.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('PUT', '/periodes/' + first.id, {
        ...data,
        nom: 'T1 renommé',
        version: first.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('DELETE', '/periodes/batch', { ids: [first.id, second.id] })).status,
    409,
  );
  assert.equal((await api('GET', '/periodes/' + second.id)).status, 200);
  assert.equal((await api('DELETE', '/periodes/' + second.id)).status, 200);
  assert.equal((await api('GET', '/periodes/' + second.id)).status, 404);
});

test('HTTP MongoDB : matières, hiérarchie, lots multi-niveaux, lecture et versions', async () => {
  const { parent, cycle, niveau } = await setup();
  const input = { nom: 'Mathématiques', coefficient: 3, niveauClasseId: niveau.id };
  const first = await create('/matieres', input);
  const record = await api<{
    niveauClasse: string;
    cycleId: string;
    niveauScolaireId: string;
  }>('GET', '/matieres/' + first.id);
  assert.equal(record.body.niveauClasse, 'Sixième');
  assert.equal(record.body.cycleId, cycle.id);
  assert.equal(record.body.niveauScolaireId, parent.id);
  assert.equal(
    (await api('POST', '/matieres', { ...input, nom: '  MATHÉMATIQUES ' })).status,
    409,
  );
  const autre = await create('/niveaux-classes', { nom: 'Cinquième', cycleId: cycle.id });
  const report = await api<Batch>('POST', '/matieres/batch', {
    items: [
      { ...input, niveauClasseId: autre.id },
      { ...input, nom: 'Français' },
      { ...input, nom: 'MATHÉMATIQUES' },
      { ...input, nom: 'Anglais', coefficient: 0 },
    ],
  });
  assert.equal(report.body.success.length, 2);
  assert.equal(report.body.errors.length, 2);
  assert.equal(
    (await api<unknown[]>('GET', '/matieres/by-niveau-classe/' + niveau.id)).body.length,
    2,
  );
  assert.equal(
    (
      await api<unknown[]>(
        'GET',
        '/matieres?recherche=mathematiques&niveauClasseId=' + autre.id,
      )
    ).body.length,
    1,
  );
  assert.equal(
    (
      await api('PUT', '/matieres/' + first.id, {
        ...input,
        nom: 'Maths',
        version: first.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('PUT', '/matieres/' + first.id, { ...input, version: first.version }))
      .status,
    409,
  );
  assert.equal(
    (
      await api('PUT', '/matieres/' + first.id, {
        ...input,
        niveauClasseId: autre.id,
        version: first.version + 1,
      })
    ).status,
    409,
  );
});

test('HTTP MongoDB : matières utilisées, coefficient et suppressions atomiques protégés', async () => {
  const { niveau } = await setup();
  const input = { nom: 'Français', coefficient: 2, niveauClasseId: niveau.id };
  const first = await create('/matieres', input);
  const second = await create('/matieres', { ...input, nom: 'Anglais' });
  const db = mongoose.connection.db!;
  await db
    .collection('notes')
    .insertOne({ matiereId: new mongoose.Types.ObjectId(first.id), isDeleted: false });
  assert.equal(
    (await api('DELETE', '/matieres/batch', { ids: [first.id, second.id] })).status,
    409,
  );
  assert.equal((await api('GET', '/matieres/' + second.id)).status, 200);
  assert.equal(
    (
      await api('PUT', '/matieres/' + first.id, {
        ...input,
        coefficient: 4,
        version: first.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('PUT', '/matieres/' + first.id, {
        ...input,
        nom: 'Français renommé',
        version: first.version,
      })
    ).status,
    200,
  );
  assert.equal((await api('DELETE', '/niveaux-classes/' + niveau.id)).status, 409);
  assert.equal((await api('DELETE', '/matieres/' + second.id)).status, 200);
  assert.equal((await api('GET', '/matieres/' + second.id)).status, 404);
  assert.equal(
    (await api('POST', '/matieres', { ...input, nom: 'ANGLAIS' })).status,
    409,
  );
});

test('HTTP MongoDB : matière concurrente unique et affectation enseignant protégée', async () => {
  const { niveau } = await setup();
  const input = { nom: 'Histoire', coefficient: 1, niveauClasseId: niveau.id };
  const responses = await Promise.all([
    api('POST', '/matieres', input),
    api('POST', '/matieres', { ...input, nom: 'HISTOIRE' }),
  ]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [201, 409]);
  const record = responses.find((item) => item.status === 201)!.body;
  await mongoose.connection.db!.collection('enseignants').insertOne({
    enseignements: [{ matiereId: record.id, classeId: 'classe' }],
    isDeleted: false,
  });
  assert.equal((await api('DELETE', '/matieres/' + record.id)).status, 409);
});

test('HTTP MongoDB : enseignant, affectations enrichies, recherche et lectures ciblées', async () => {
  const { first, second, niveau } = await setup();
  const subject = await create('/matieres', {
    nom: 'Mathématiques',
    coefficient: 3,
    niveauClasseId: niveau.id,
  });
  const input = {
    nom: 'Boni',
    prenom: 'Émilie',
    email: ' TEACHER@EXAMPLE.COM ',
    tel: '123',
    enseignements: [{ classeId: first.id, matiereId: subject.id }],
  };
  const record = await create('/teachers', input);
  const detail = await api<{
    email: string;
    enseignementsData: { classe: string; niveauClasse: string }[];
  }>('GET', '/teachers/' + record.id);
  assert.equal(detail.body.email, 'teacher@example.com');
  assert.equal(detail.body.enseignementsData[0].niveauClasse, 'Sixième');
  assert.equal(
    (await api<unknown[]>('GET', '/teachers/by-classe/' + first.id)).body.length,
    1,
  );
  assert.equal(
    (await api<unknown[]>('GET', '/teachers/by-matiere/' + subject.id)).body.length,
    1,
  );
  assert.equal(
    (await api<unknown[]>('POST', '/teachers/search', { recherche: 'emilie' })).body
      .length,
    1,
  );
  assert.equal(
    (await api<unknown[]>('POST', '/teachers/search', { recherche: 'mathematiques' }))
      .body.length,
    1,
  );
  assert.equal(
    (
      await api('PUT', '/teachers/' + record.id, {
        ...input,
        enseignements: [{ classeId: second.id, matiereId: subject.id }],
        version: record.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('PUT', '/teachers/' + record.id, { ...input, version: record.version }))
      .status,
    409,
  );
  assert.equal((await api('DELETE', '/matieres/' + subject.id)).status, 409);
  assert.equal((await api('DELETE', '/classes/' + second.id)).status, 409);
});

test('HTTP MongoDB : exclusivité concurrente classe-matière et emails facultatifs uniques', async () => {
  const { first, niveau } = await setup();
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: niveau.id,
  });
  const input = {
    nom: 'Boni',
    prenom: 'Alice',
    enseignements: [{ classeId: first.id, matiereId: subject.id }],
  };
  const responses = await Promise.all([
    api('POST', '/teachers', { ...input, email: 'a@example.com' }),
    api('POST', '/teachers', { ...input, prenom: 'Bob', email: 'b@example.com' }),
  ]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [201, 409]);
  await create('/teachers', { nom: 'Sans', prenom: 'Email' });
  await create('/teachers', { nom: 'Autre', prenom: 'Email' });
  const teacher = await create('/teachers', {
    nom: 'Unique',
    prenom: 'Email',
    email: 'unique@example.com',
  });
  assert.equal(
    (
      await api('POST', '/teachers', {
        nom: 'Doublon',
        prenom: 'Email',
        email: ' UNIQUE@EXAMPLE.COM ',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('PUT', '/teachers/' + teacher.id, {
        nom: 'Unique',
        prenom: 'Email',
        email: 'bizarre',
        version: teacher.version,
      })
    ).status,
    400,
  );
});

test('HTTP MongoDB : séances historiques bloquent retrait et suppression collective', async () => {
  const { first, niveau } = await setup();
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: niveau.id,
  });
  const input = {
    nom: 'Boni',
    prenom: 'Alice',
    enseignements: [{ classeId: first.id, matiereId: subject.id }],
  };
  const teacher = await create('/teachers', input);
  const other = await create('/teachers', { nom: 'Sans', prenom: 'Affectation' });
  await mongoose.connection.db!.collection('seances').insertOne({
    enseignantId: new mongoose.Types.ObjectId(teacher.id),
    classeId: new mongoose.Types.ObjectId(first.id),
    matiereId: new mongoose.Types.ObjectId(subject.id),
    isDeleted: false,
  });
  assert.equal(
    (
      await api('PUT', '/teachers/' + teacher.id, {
        ...input,
        enseignements: [],
        version: teacher.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (await api('DELETE', '/teachers/batch', { ids: [teacher.id, other.id] })).status,
    409,
  );
  assert.equal((await api('GET', '/teachers/' + other.id)).status, 200);
  assert.equal((await api('DELETE', '/teachers/' + other.id)).status, 200);
  assert.equal((await api('GET', '/teachers/' + other.id)).status, 404);
});

test('HTTP MongoDB : enseignant incompatible, doublon interne et lot partiel', async () => {
  const { first, cycle, niveau } = await setup();
  const otherLevel = await create('/niveaux-classes', {
    nom: 'Cinquième',
    cycleId: cycle.id,
  });
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: otherLevel.id,
  });
  const compatible = await create('/matieres', {
    nom: 'Français',
    coefficient: 2,
    niveauClasseId: niveau.id,
  });
  const base = { nom: 'Boni', prenom: 'Alice' };
  assert.equal(
    (
      await api('POST', '/teachers', {
        ...base,
        enseignements: [{ classeId: first.id, matiereId: subject.id }],
      })
    ).status,
    409,
  );
  const assignment = { classeId: first.id, matiereId: compatible.id };
  assert.equal(
    (await api('POST', '/teachers', { ...base, enseignements: [assignment, assignment] }))
      .status,
    400,
  );
  const report = await api<Batch>('POST', '/teachers/batch', {
    items: [
      { ...base, email: 'a@example.com' },
      { ...base, email: 'A@EXAMPLE.COM' },
      { ...base, prenom: 'Bob' },
    ],
  });
  assert.equal(report.body.success.length, 2);
  assert.equal(report.body.errors.length, 1);
});

test('HTTP MongoDB : filtres hiérarchiques enseignants sur la même affectation', async () => {
  const { parent, cycle, niveau, first } = await setup();
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: niveau.id,
  });
  await create('/teachers', {
    nom: 'Boni',
    prenom: 'Alice',
    enseignements: [{ classeId: first.id, matiereId: subject.id }],
  });
  const query = new URLSearchParams({
    niveauScolaireId: parent.id,
    cycleId: cycle.id,
    niveauClasseId: niveau.id,
    classeId: first.id,
    matiereId: subject.id,
  });
  assert.equal((await api<unknown[]>('GET', '/teachers?' + query)).body.length, 1);
  query.set('niveauClasseId', new mongoose.Types.ObjectId().toString());
  assert.equal((await api<unknown[]>('GET', '/teachers?' + query)).body.length, 0);
});

test('HTTP MongoDB : évaluations, coefficient, périmètre et consultation matière-période', async () => {
  const { parent, niveau } = await setup();
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: niveau.id,
  });
  const period = await create('/periodes', {
    nom: 'T1',
    ordre: 1,
    coefficient: 1,
    niveauScolaireId: parent.id,
  });
  const input = { nom: 'Devoir 1', type: 'devoir', coefficient: 2, periodeId: period.id };
  const record = await create('/evaluations', input);
  const detail = await api<{
    coefficient: number;
    niveauScolaireId: string;
    abreviation: string;
  }>('GET', '/evaluations/' + record.id);
  assert.equal(detail.body.coefficient, 2);
  assert.equal(detail.body.niveauScolaireId, parent.id);
  assert.equal(detail.body.abreviation, 'DEV');
  await create('/evaluations', { nom: 'Global', type: 'composition', coefficient: 1 });
  await create('/evaluations', {
    nom: 'Niveau',
    type: 'interrogation',
    coefficient: 1,
    niveauScolaireId: parent.id,
  });
  assert.equal(
    (await api<unknown[]>('GET', '/evaluations/by-periode/' + period.id)).body.length,
    1,
  );
  assert.equal(
    (await api<unknown[]>('GET', '/evaluations/by-niveau-scolaire/' + parent.id)).body
      .length,
    3,
  );
  assert.equal(
    (
      await api<unknown[]>(
        'GET',
        '/evaluations/by-periode-and-matiere/' + period.id + '/' + subject.id,
      )
    ).body.length,
    3,
  );
  assert.equal(
    (await api<unknown[]>('GET', '/evaluations?periodeId=none')).body.length,
    2,
  );
  assert.equal((await api('GET', '/evaluations?matiereId=' + subject.id)).status, 400);
});

test('HTTP MongoDB : évaluation notée protégée, modification et lot atomique', async () => {
  const { parent } = await setup();
  const period = await create('/periodes', {
    nom: 'T1',
    ordre: 1,
    coefficient: 1,
    niveauScolaireId: parent.id,
  });
  const input = { nom: 'Devoir 1', type: 'devoir', coefficient: 2, periodeId: period.id };
  const first = await create('/evaluations', input);
  const second = await create('/evaluations', { ...input, nom: 'Devoir 2' });
  await mongoose.connection
    .db!.collection('notes')
    .insertOne({ evaluationId: new mongoose.Types.ObjectId(first.id), isDeleted: false });
  assert.equal(
    (
      await api('PUT', '/evaluations/' + first.id, {
        ...input,
        coefficient: 3,
        version: first.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('PUT', '/evaluations/' + first.id, {
        ...input,
        nom: 'Renommé',
        version: first.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('PUT', '/evaluations/' + first.id, { ...input, version: first.version }))
      .status,
    409,
  );
  assert.equal(
    (await api('DELETE', '/evaluations/batch', { ids: [first.id, second.id] })).status,
    409,
  );
  assert.equal((await api('GET', '/evaluations/' + second.id)).status, 200);
  assert.equal((await api('DELETE', '/periodes/' + period.id)).status, 409);
  assert.equal((await api('DELETE', '/evaluations/' + second.id)).status, 200);
  assert.equal((await api('GET', '/evaluations/' + second.id)).status, 404);
});

test('HTTP MongoDB : évaluations incompatibles, lot partiel et doublon concurrent', async () => {
  const { parent, niveau } = await setup();
  const other = await create('/niveaux-scolaires', { nom: 'Primaire', notePlafond: 10 });
  const period = await create('/periodes', {
    nom: 'T1',
    ordre: 1,
    coefficient: 1,
    niveauScolaireId: other.id,
  });
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: niveau.id,
  });
  const input = {
    nom: 'Composition',
    type: 'composition',
    coefficient: 1,
    periodeId: period.id,
  };
  assert.equal(
    (await api('POST', '/evaluations', { ...input, niveauScolaireId: parent.id })).status,
    409,
  );
  assert.equal(
    (
      await api(
        'GET',
        '/evaluations/by-periode-and-matiere/' + period.id + '/' + subject.id,
      )
    ).status,
    409,
  );
  const responses = await Promise.all([
    api('POST', '/evaluations', input),
    api('POST', '/evaluations', { ...input, nom: 'COMPOSITION' }),
  ]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [201, 409]);
  const report = await api<Batch>('POST', '/evaluations/batch', {
    items: [
      input,
      { ...input, nom: 'Devoir', type: 'devoir' },
      { ...input, nom: 'Invalide', coefficient: 0 },
    ],
  });
  assert.equal(report.body.success.length, 1);
  assert.equal(report.body.errors.length, 2);
});

async function noteSetup() {
  const context = await setup();
  const subject = await create('/matieres', {
    nom: 'Maths',
    coefficient: 3,
    niveauClasseId: context.niveau.id,
  });
  const period = await create('/periodes', {
    nom: 'T1',
    ordre: 1,
    coefficient: 1,
    niveauScolaireId: context.parent.id,
  });
  const evaluation = await create('/evaluations', {
    nom: 'Devoir 1',
    type: 'devoir',
    coefficient: 2,
    periodeId: period.id,
  });
  const teacherInput = {
    nom: 'Boni',
    prenom: 'Alice',
    enseignements: [{ classeId: context.first.id, matiereId: subject.id }],
  };
  const teacher = await create('/teachers', teacherInput);
  const inscription = await create('/inscriptions', context.input);
  const noteInput = {
    inscriptionId: inscription.id,
    matiereId: subject.id,
    periodeId: period.id,
    evaluationId: evaluation.id,
    note: 0,
  };
  return {
    ...context,
    subject,
    period,
    evaluation,
    teacher,
    teacherInput,
    inscription,
    noteInput,
  };
}
test('HTTP MongoDB : note zéro, coefficient et enseignant déduits, bulletin atomique', async () => {
  const { noteInput, teacher, student, first, inscription } = await noteSetup();
  const note = await create('/notes', noteInput);
  const detail = await api<{
    note: number;
    coefficient: number;
    enseignantId: string;
    notePlafond: number;
  }>('GET', '/notes/' + note.id);
  assert.equal(detail.body.note, 0);
  assert.equal(detail.body.notePlafond, 20);
  assert.equal(detail.body.coefficient, 2);
  assert.equal(detail.body.enseignantId, teacher.id);
  for (const path of [
    '/notes/by-inscription/' + inscription.id,
    '/notes/by-matiere/' + noteInput.matiereId,
    '/notes/by-periode/' + noteInput.periodeId,
    '/notes/by-classe/' + first.id,
    '/notes/by-student/' + student.id,
  ])
    assert.equal((await api<unknown[]>('GET', path)).body.length, 1);
  assert.equal(
    (await api<unknown[]>('GET', '/notes?closed=false&recherche=emilie')).body.length,
    1,
  );
  const bulletin = await mongoose.connection
    .db!.collection('bulletins')
    .findOne({ inscriptionId: new mongoose.Types.ObjectId(inscription.id) });
  assert.equal(bulletin?.needsRecalculation, true);
  assert.equal(
    (
      await api('POST', '/notes', {
        ...noteInput,
        note: 21,
        evaluationId: new mongoose.Types.ObjectId().toString(),
      })
    ).status,
    409,
  );
});
test('HTTP MongoDB : note clôturée protégée et clôture collective partielle', async () => {
  const { noteInput } = await noteSetup();
  const note = await create('/notes', noteInput);
  const update = await api('PUT', '/notes/' + note.id, {
    version: 0,
    note: 30,
    notePlafond: 40,
    coefficient: 4,
  });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  assert.equal(
    (await api('PUT', '/notes/' + note.id, { version: 0, note: 10 })).status,
    409,
  );
  assert.equal(
    (await api('PATCH', '/notes/' + note.id + '/close', { version: 1 })).status,
    200,
  );
  assert.equal(
    (await api('PUT', '/notes/' + note.id, { version: 2, note: 10 })).status,
    409,
  );
  assert.equal((await api('DELETE', '/notes/' + note.id)).status, 409);
  const result = await api<Batch>('PATCH', '/notes/batch/close', {
    items: [
      { id: note.id, version: 2 },
      { id: new mongoose.Types.ObjectId().toString(), version: 0 },
    ],
  });
  assert.equal(result.body.errors.length, 2);
});
test('HTTP MongoDB : import matricule borné à la classe et l’année, zéro et erreurs partielles', async () => {
  const { noteInput, first, second } = await noteSetup();
  const input = {
    classeId: first.id,
    anneeScolaire: '2024-2025',
    matiereId: noteInput.matiereId,
    periodeId: noteInput.periodeId,
    evaluationId: noteInput.evaluationId,
    notes: [
      { matricule: 'ml-001', note: 0 },
      { matricule: 'inconnu', note: 10 },
      { matricule: 'ml-001', note: '' },
    ],
  };
  const result = await api<Batch>('POST', '/notes/import', input);
  assert.equal(result.body.success.length, 1, JSON.stringify(result.body));
  assert.equal(result.body.errors.length, 2);
  const wrong = await api<Batch>('POST', '/notes/import', {
    ...input,
    classeId: second.id,
    notes: [{ matricule: 'ml-001', note: 10 }],
  });
  assert.equal(wrong.body.success.length, 0);
});
test('HTTP MongoDB : dépendances et affectations protégées, suppression note puis recréation', async () => {
  const { noteInput, evaluation, teacher, teacherInput, inscription } = await noteSetup();
  const note = await create('/notes', noteInput);
  assert.equal((await api('DELETE', '/evaluations/' + evaluation.id)).status, 409);
  assert.equal((await api('DELETE', '/teachers/' + teacher.id)).status, 409);
  assert.equal((await api('DELETE', '/inscriptions/' + inscription.id)).status, 409);
  assert.equal(
    (
      await api('PUT', '/teachers/' + teacher.id, {
        ...teacherInput,
        enseignements: [],
        version: teacher.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('DELETE', '/notes/batch', {
        ids: [note.id, new mongoose.Types.ObjectId().toString()],
      })
    ).status,
    404,
  );
  assert.equal((await api('GET', '/notes/' + note.id)).status, 200);
  assert.equal((await api('DELETE', '/notes/' + note.id)).status, 200);
  await create('/notes', noteInput);
});
test('HTTP MongoDB : note concurrente unique et bulletin verrouillé annule les écritures', async () => {
  const { noteInput, inscription } = await noteSetup();
  const result = await Promise.all([
    api('POST', '/notes', noteInput),
    api('POST', '/notes', noteInput),
  ]);
  assert.deepEqual(result.map((item) => item.status).sort(), [201, 409]);
  const note = result.find((item) => item.status === 201)!.body;
  await mongoose.connection
    .db!.collection('bulletins')
    .updateOne(
      { inscriptionId: new mongoose.Types.ObjectId(inscription.id) },
      { $set: { status: 'publie' } },
    );
  assert.equal(
    (await api('PUT', '/notes/' + note.id, { version: 0, note: 10 })).status,
    409,
  );
  assert.equal((await api('DELETE', '/notes/' + note.id)).status, 409);
  assert.equal((await api<{ note: number }>('GET', '/notes/' + note.id)).body.note, 0);
});

test('HTTP MongoDB : clôture et création simultanées partagent un seul brouillon', async () => {
  const { noteInput, inscription, period } = await noteSetup();
  const first = await create('/notes', noteInput);
  const evaluation = await create('/evaluations', {
    nom: 'Devoir 2',
    type: 'devoir',
    coefficient: 1,
    periodeId: period.id,
  });
  await mongoose.connection
    .db!.collection('bulletins')
    .deleteMany({ inscriptionId: new mongoose.Types.ObjectId(inscription.id) });
  const result = await Promise.all([
    api('PATCH', '/notes/' + first.id + '/close', { version: 0 }),
    api('POST', '/notes', { ...noteInput, evaluationId: evaluation.id, note: 10 }),
  ]);
  assert.deepEqual(result.map((item) => item.status).sort(), [200, 201]);
  assert.equal(
    await mongoose.connection
      .db!.collection('bulletins')
      .countDocuments({ inscriptionId: new mongoose.Types.ObjectId(inscription.id) }),
    1,
  );
});

async function teacherPortalFixture() {
  const context = await noteSetup();
  const created = await api<{ id: string; email: string }>(
    'POST',
    `/teachers/${context.teacher.id}/account`,
    { email: 'teacher@example.invalid', password: 'teacher-test-password' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const accountId = created.body.id;
  const teacherToken = jwt.sign({ id: accountId }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  async function portal(method: string, path: string, input?: unknown) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, body: await response.json() };
  }
  return {
    ...context,
    noteInput: {
      ...context.noteInput,
      classeId: context.first.id,
      anneeScolaire: context.input.anneeScolaire,
      expectedNotePlafond: 20,
      expectedCoefficient: 2,
    },
    portal,
    accountId,
  };
}
function teacherJob(data: unknown, targetId?: string, version = 0, action = 'save') {
  return {
    operationId: randomUUID(),
    items: [
      {
        localId: randomUUID(),
        targetId,
        version,
        action,
        ...(action === 'save' ? { data } : {}),
      },
    ],
  };
}
test('Espace enseignant : compte rattaché, données privées réduites et routes administration refusées', async () => {
  const f = await teacherPortalFixture();
  const snapshot = await f.portal('GET', '/teacher/workspace');
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
  assert.equal(snapshot.body.ownerId, f.accountId);
  assert.deepEqual(
    snapshot.body.classes.map((item: { id: string }) => item.id),
    [f.first.id],
  );
  assert.equal(snapshot.body.students.length, 1);
  assert.equal(snapshot.body.students[0].id, f.inscription.id);
  assert.equal(snapshot.body.students[0].dateNaissance, undefined);
  assert.equal(snapshot.body.students[0].eleveDataId, undefined);
  for (const path of [
    '/teachers',
    '/students',
    '/inscriptions',
    '/notes',
    '/notes/sync',
    '/classes',
  ]) {
    assert.equal((await f.portal('GET', path)).status, 403, path);
  }
  assert.equal((await api('GET', '/teacher/workspace')).status, 403);
  assert.equal(
    (
      await api('POST', `/teachers/${f.teacher.id}/account`, {
        email: 'another@example.invalid',
        password: 'teacher-test-password',
      })
    ).status,
    409,
  );
  const unlinked = await User.create({
    email: 'unlinked@example.invalid',
    username: 'Sans dossier',
    role: 'teacher',
    isVerified: true,
  });
  const noLinkToken = jwt.sign({ id: String(unlinked._id) }, process.env.JWT_SECRET!);
  assert.equal(
    (
      await fetch(baseUrl + '/teacher/workspace', {
        headers: { Authorization: `Bearer ${noLinkToken}` },
      })
    ).status,
    403,
  );
  const account = await api<{ password?: string; status: string }>(
    'GET',
    `/teachers/${f.teacher.id}/account`,
  );
  assert.equal(account.body.password, undefined);
  const login = await api<{ user: { role: string } }>('POST', '/auth/login', {
    email: 'teacher@example.invalid',
    password: 'teacher-test-password',
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'teacher');
  assert.equal(
    (
      await api('PUT', `/teachers/${f.teacher.id}/account`, {
        status: 'active',
        password: 'teacher-new-password',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api('POST', '/auth/login', {
        email: 'teacher@example.invalid',
        password: 'teacher-test-password',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api('POST', '/auth/login', {
        email: 'teacher@example.invalid',
        password: 'teacher-new-password',
      })
    ).status,
    200,
  );

  await api('PUT', `/teachers/${f.teacher.id}/account`, { status: 'inactive' });
  assert.equal((await f.portal('GET', '/teacher/workspace')).status, 401);
});

test('Espace enseignant : logo institutionnel autorisé sans accès aux autres images privées', async () =>
  withMediaStore(async (objects) => {
    const f = await teacherPortalFixture();
    await api('POST', '/etablissement', { ...schoolInput(), version: 0 });
    objects.set('school/test-logo.png', Buffer.from(schoolPng.split(',')[1], 'base64'));
    await MediaSlot.create({
      key: 'school:school:logo',
      entity: 'school',
      targetId: 'school',
      kind: 'logo',
      revision: 3,
      objectKey: 'school/test-logo.png',
      mime: 'image/png',
    });
    const snapshot = await f.portal('GET', '/teacher/workspace');
    assert.equal(snapshot.body.school.logoRevision, 3);
    const logo = await f.portal('GET', '/teacher/logo');
    assert.equal(logo.status, 200);
    assert.equal(logo.body.revision, 3);
    assert.equal(logo.body.image, schoolPng);
    assert.equal((await f.portal('GET', '/media/school/school/logo')).status, 403);
    assert.equal((await api('GET', '/teacher/logo')).status, 403);
  }));

test('Espace enseignant : changement personnel du mot de passe par HTTP et contrôle de propriété', async () => {
  const f = await teacherPortalFixture();
  assert.equal(
    (
      await f.portal('PUT', '/auth/password', {
        currentPassword: 'wrong',
        newPassword: 'teacher-personal-new',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.portal('PUT', '/auth/password', {
        currentPassword: 'teacher-test-password',
        newPassword: 'teacher-personal-new',
        ownerId: 'other',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.portal('PUT', '/auth/password', {
        currentPassword: 'teacher-test-password',
        newPassword: 'teacher-personal-new',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api('POST', '/auth/login', {
        email: 'teacher@example.invalid',
        password: 'teacher-test-password',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await api('POST', '/auth/login', {
        email: 'teacher@example.invalid',
        password: 'teacher-personal-new',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(baseUrl + '/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'teacher-personal-new',
          newPassword: 'another-password-new',
        }),
      })
    ).status,
    401,
  );
});

test('Espace enseignant : saisie, rejeu après coupure, versions, barème et notes clôturées', async () => {
  const f = await teacherPortalFixture();
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, expectedNotePlafond: 10 }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, expectedCoefficient: 9 }),
      )
    ).status,
    409,
  );
  const request = teacherJob(f.noteInput);
  const first = await f.portal('POST', '/teacher/notes/sync', request);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const record = first.body.items[0].record;
  assert.equal(record.note, 0);
  const replay = await f.portal('POST', '/teacher/notes/sync', request);
  assert.deepEqual(replay.body, first.body);
  const changedRequest = structuredClone(request);
  (changedRequest.items[0].data as { note: number }).note = 12;
  assert.equal(
    (await f.portal('POST', '/teacher/notes/sync', changedRequest)).status,
    409,
  );
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, note: 21 }, record.id, record.version),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, coefficient: 9 }, record.id, record.version),
      )
    ).status,
    400,
  );
  const updated = await f.portal(
    'POST',
    '/teacher/notes/sync',
    teacherJob({ ...f.noteInput, note: 14 }, record.id, record.version),
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.items[0].record.note, 14);
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, note: 15 }, record.id, record.version),
      )
    ).status,
    409,
  );
  await api('PATCH', `/notes/${record.id}/close`, {
    version: updated.body.items[0].record.version,
  });
  const closed = await f.portal('GET', '/teacher/workspace');
  const closedNote = closed.body.notes[0];
  assert.equal(closedNote.closed, true);
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, note: 12 }, record.id, closedNote.version),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob(undefined, record.id, closedNote.version, 'delete'),
      )
    ).status,
    409,
  );
});

test('Espace enseignant : classe et matière étrangères, retrait individuel et groupé, révocation', async () => {
  const f = await teacherPortalFixture();
  const foreignPupil = await create('/students', {
    ...f.studentInput,
    matricule: 'FOREIGN',
  });
  const foreignRegistration = await create('/inscriptions', {
    ...f.input,
    eleveDataId: foreignPupil.id,
    classeId: f.second.id,
  });
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, inscriptionId: foreignRegistration.id }),
      )
    ).status,
    403,
  );
  const foreignSubject = await create('/matieres', {
    nom: 'Anglais',
    coefficient: 2,
    niveauClasseId: f.niveau.id,
  });
  assert.equal(
    (
      await f.portal(
        'POST',
        '/teacher/notes/sync',
        teacherJob({ ...f.noteInput, matiereId: foreignSubject.id }),
      )
    ).status,
    403,
  );
  const first = await f.portal('POST', '/teacher/notes/sync', teacherJob(f.noteInput));
  const note = first.body.items[0].record;
  const removed = await f.portal(
    'POST',
    '/teacher/notes/sync',
    teacherJob(undefined, note.id, note.version, 'delete'),
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.items[0].record.isDeleted, true);
  const next = await f.portal(
    'POST',
    '/teacher/notes/sync',
    teacherJob({ ...f.noteInput, note: 10 }),
  );
  const nextNote = next.body.items[0].record;
  const evaluation = await create('/evaluations', {
    nom: 'Devoir 2',
    type: 'devoir',
    coefficient: 1,
    periodeId: f.period.id,
  });
  const second = await f.portal(
    'POST',
    '/teacher/notes/sync',
    teacherJob({
      ...f.noteInput,
      evaluationId: evaluation.id,
      expectedCoefficient: 1,
      note: 11,
    }),
  );
  const secondNote = second.body.items[0].record;
  const bulk = {
    operationId: randomUUID(),
    items: [nextNote, secondNote].map((item) => ({
      localId: item.id,
      targetId: item.id,
      version: item.version,
      action: 'delete',
    })),
  };
  assert.equal((await f.portal('POST', '/teacher/notes/sync', bulk)).status, 200);
  assert.equal((await f.portal('GET', '/teacher/workspace')).body.notes.length, 0);
  await mongoose.connection
    .collection('enseignants')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(f.teacher.id) },
      { $set: { enseignements: [] } },
    );
  assert.equal((await f.portal('GET', '/teacher/workspace')).body.classes.length, 0);
  assert.equal(
    (await f.portal('POST', '/teacher/notes/sync', teacherJob(f.noteInput))).status,
    403,
  );
});

test('Espace enseignant : une note ne peut pas être corrigée à travers une autre scolarité', async () => {
  const f = await teacherPortalFixture();
  const created = await f.portal('POST', '/teacher/notes/sync', teacherJob(f.noteInput));
  const note = created.body.items[0].record;
  // Reproduce an old class reference left behind after a historical transfer.
  await mongoose.connection
    .collection('inscriptions')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(f.inscription.id) },
      { $set: { classeId: new mongoose.Types.ObjectId(f.second.id) } },
    );
  await mongoose.connection
    .collection('enseignants')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(f.teacher.id) },
      { $set: { enseignements: [{ classeId: f.second.id, matiereId: f.subject.id }] } },
    );
  const changed = await f.portal(
    'POST',
    '/teacher/notes/sync',
    teacherJob({ ...f.noteInput, note: 18 }, note.id, note.version),
  );
  assert.equal(changed.status, 409, JSON.stringify(changed.body));
  const removed = await f.portal(
    'POST',
    '/teacher/notes/sync',
    teacherJob(undefined, note.id, note.version, 'delete'),
  );
  assert.equal(removed.status, 409);
  const preserved = await api<{ note: number }>('GET', `/notes/${note.id}`);
  assert.equal(preserved.body.note, 0);
});

test('Espace enseignant : une saisie différée ne change pas de classe lors de son envoi', async () => {
  const f = await teacherPortalFixture();
  const pending = teacherJob({ ...f.noteInput, note: 14 });
  await mongoose.connection
    .collection('inscriptions')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(f.inscription.id) },
      { $set: { classeId: new mongoose.Types.ObjectId(f.second.id) } },
    );
  await mongoose.connection
    .collection('enseignants')
    .updateOne(
      { _id: new mongoose.Types.ObjectId(f.teacher.id) },
      { $set: { enseignements: [{ classeId: f.second.id, matiereId: f.subject.id }] } },
    );
  const result = await f.portal('POST', '/teacher/notes/sync', pending);
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal((await api<unknown[]>('GET', '/notes')).body.length, 0);
});

test('HTTP MongoDB : bulletin complet sans évaluation facultative, note conservée quand elle existe', async () => {
  const f = await noteSetup();
  await create('/notes', { ...f.noteInput, note: 12 });
  const optional = await create('/evaluations', {
    nom: '3ème interrogation',
    type: 'interrogation',
    coefficient: 1,
    periodeId: f.period.id,
    obligatoire: false,
  });
  const evaluation = (
    await api<{ obligatoire: boolean; version: number }>(
      'GET',
      '/evaluations/' + optional.id,
    )
  ).body;
  assert.equal(evaluation.obligatoire, false);
  const edited = await api<{ obligatoire: boolean }>(
    'PUT',
    '/evaluations/' + optional.id,
    {
      nom: '3ème interrogation',
      type: 'interrogation',
      coefficient: 1,
      periodeId: f.period.id,
      version: evaluation.version,
    },
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.body.obligatoire, false);
  const draft = await create('/bulletins', {
    inscriptionId: f.inscription.id,
    periodeId: f.period.id,
  });
  await api('PUT', '/bulletins/' + draft.id, {
    version: draft.version,
    vieScolaire: { conduite: 0 },
  });
  const generate = () =>
    api<{ success: BulletinWithDetails[]; errors: unknown[] }>(
      'POST',
      '/bulletins/generate',
      { periodeId: f.period.id, bulletinIds: [draft.id] },
    );
  const first = await generate();
  assert.deepEqual(first.body.errors, []);
  assert.equal(first.body.success[0].status, 'complet');
  const mean = first.body.success[0].resultatFinal!.moyenneGenerale;
  await create('/notes', { ...f.noteInput, evaluationId: optional.id, note: 20 });
  const second = await generate();
  assert.equal(second.body.success[0].status, 'complet');
  assert.notEqual(second.body.success[0].resultatFinal!.moyenneGenerale, mean);
  const read = (await api<BulletinWithDetails>('GET', '/bulletins/' + draft.id)).body;
  assert.equal(read.needsRecalculation, false);
});
