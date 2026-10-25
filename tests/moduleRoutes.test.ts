import noteRoutes from '../src/routes/noteRoutes';
import authRoutes from '../src/routes/authRoutes';
import { authenticatedMiddleware } from '../src/middlewares/authenticatedMiddleware';
import bulletinRoutes from '../src/routes/bulletinRoutes';
import etablissementRoutes from '../src/routes/etablissementRoutes';
import mediaRoutes from '../src/routes/mediaRoutes';
import evaluationRoutes from '../src/routes/evaluationRoutes';
import teacherRoutes from '../src/routes/teacherRoutes';
import matiereRoutes from '../src/routes/matiereRoutes';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Router } from 'express';
import niveauScolaireRoutes from '../src/routes/niveauScolaireRoutes';
import cycleRoutes from '../src/routes/cycleRoutes';
import niveauClasseRoutes from '../src/routes/niveauClasseRoutes';
import classeRoutes from '../src/routes/classeRoutes';
import studentRoutes from '../src/routes/studentRoutes';
import periodeRoutes from '../src/routes/periodeRoutes';
import inscriptionRoutes from '../src/routes/inscriptionRoutes';
import { administratorMiddleware } from '../src/middlewares/administratorMiddleware';

type RouteStack = {
  handle: unknown;
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
}[];
function stack(router: Router) {
  return (router as unknown as { stack: RouteStack }).stack;
}
function routes(router: Router) {
  return stack(router).flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map(
          (method) => `${method.toUpperCase()} ${layer.route!.path}`,
        )
      : [],
  );
}

test('authentification : identité et autorisation hors connexion exigent une session serveur', () => {
  const registered = routes(authRoutes);
  assert.ok(registered.includes('POST /login'));
  assert.ok(registered.includes('GET /me'));
  assert.ok(registered.includes('POST /offline-access'));
  for (const path of ['/me', '/offline-access'])
    assert.equal(
      stack(authRoutes).find((layer) => layer.route?.path === path)?.route?.stack[0]
        .handle,
      authenticatedMiddleware,
    );
});

const modules = [
  {
    name: 'bulletins',
    router: bulletinRoutes,
    extra: [
      'GET /by-periode/:periodeId',
      'GET /by-classe-and-periode/:classeId/:periodeId',
      'GET /by-periode-and-inscription/:periodeId/:inscriptionId',
      'PUT /save',
      'PUT /batch/save',
      'POST /generate',
      'POST /ranks',
      'GET /config',
      'PUT /config',
      'DELETE /config',
      'POST /:id/restore',
    ],
  },
  {
    name: 'notes',
    router: noteRoutes,
    extra: [
      'GET /by-inscription/:parentId',
      'GET /by-matiere/:parentId',
      'GET /by-periode/:parentId',
      'GET /by-classe/:parentId',
      'GET /by-student/:parentId',
      'PATCH /:id/close',
      'PATCH /batch/close',
      'POST /import',
    ],
  },
  {
    name: 'évaluations',
    router: evaluationRoutes,
    extra: [
      'GET /by-periode/:parentId',
      'GET /by-niveau-scolaire/:parentId',
      'GET /by-periode-and-matiere/:periodeId/:matiereId',
    ],
  },
  {
    name: 'enseignants',
    router: teacherRoutes,
    extra: ['GET /by-classe/:parentId', 'GET /by-matiere/:parentId', 'POST /search'],
  },
  { name: 'matières', router: matiereRoutes, extra: ['GET /by-niveau-classe/:parentId'] },
  {
    name: 'périodes',
    router: periodeRoutes,
    extra: ['GET /by-niveau-scolaire/:parentId', 'GET /by-year/:year'],
  },
  {
    name: 'niveaux scolaires',
    router: niveauScolaireRoutes,
    extra: ['GET /sync', 'POST /sync'],
  },
  {
    name: 'cycles',
    router: cycleRoutes,
    extra: ['GET /by-niveau-scolaire/:parentId', 'GET /sync', 'POST /sync'],
  },
  {
    name: 'niveaux de classe',
    router: niveauClasseRoutes,
    extra: ['GET /by-cycle/:parentId', 'GET /sync', 'POST /sync'],
  },
  { name: 'classes', router: classeRoutes, extra: ['GET /by-niveau-classe/:parentId'] },
  { name: 'élèves', router: studentRoutes, extra: ['GET /by-matricule/:matricule'] },
];
for (const module of modules) {
  test(`${module.name} : actions d'EduGestion et suppressions présentes, protégées`, () => {
    const registered = routes(module.router);
    for (const endpoint of [
      'GET /',
      'GET /sync',
      'POST /sync',
      'GET /:id',
      'POST /',
      'POST /batch',
      'PUT /:id',
      'DELETE /:id',
      'DELETE /batch',
      ...module.extra,
    ]) {
      assert.ok(registered.includes(endpoint), `${module.name} : ${endpoint} absent`);
    }
    assert.equal(stack(module.router)[0].handle, administratorMiddleware);
    assert.ok(registered.indexOf('GET /sync') < registered.indexOf('GET /:id'));
  });
}

test('inscriptions : chaque opération métier possède une route dédiée protégée', () => {
  const registered = routes(inscriptionRoutes);
  for (const endpoint of [
    'GET /',
    'GET /sync',
    'POST /sync',
    'GET /:id',
    'POST /',
    'PUT /:id',
    'DELETE /:id',
    'DELETE /batch',
    'GET /active',
    'GET /by-student/:eleveDataId',
    'GET /by-student/:eleveDataId/current',
    'GET /by-classe/:classeId',
    'GET /by-year/:anneeScolaire',
    'POST /search',
    'POST /new-student',
    'POST /reenrol',
    'POST /transfer',
    'PATCH /:id/activate',
    'PATCH /:id/deactivate',
    'PATCH /batch/activate',
    'PATCH /batch/deactivate',
    'PATCH /:id/school-life',
  ])
    assert.ok(registered.includes(endpoint), `${endpoint} absent`);
  assert.equal(stack(inscriptionRoutes)[0].handle, administratorMiddleware);
  assert.ok(
    registered.indexOf('GET /active') < registered.indexOf('GET /:id'),
    'La route active serait interprétée comme un identifiant.',
  );
});

test('établissement : toutes les actions du singleton et des images sont protégées', () => {
  const registered = routes(etablissementRoutes);
  for (const endpoint of [
    'GET /',
    'GET /sync',
    'POST /sync',
    'GET /state',
    'GET /exists',
    'POST /',
    'PUT /',
    'PATCH /',
    'DELETE /',
    'DELETE /batch',
    'GET /images/:kind',
    'PUT /images/:kind',
    'DELETE /images/:kind',
  ]) {
    assert.ok(registered.includes(endpoint), `${endpoint} absent`);
  }
  assert.equal(stack(etablissementRoutes)[0].handle, administratorMiddleware);
});

test('images : routes privées et contrôle administrateur avant lecture des fichiers', () => {
  const registered = routes(mediaRoutes);
  for (const endpoint of [
    'POST /parents',
    'POST /cleanup',
    'POST /batch',
    'GET /:entity/:targetId/:kind',
    'PUT /:entity/:targetId/:kind',
    'DELETE /:entity/:targetId/:kind',
    'DELETE /batch',
  ])
    assert.ok(registered.includes(endpoint), `${endpoint} absent`);
  assert.equal(stack(mediaRoutes)[0].handle, administratorMiddleware);
});
