# Backend — CPEG Michel Lauret

Projet indépendant Express, TypeScript et Mongoose. Node.js 22 et pnpm 10 sont
utilisés pour le développement.

```powershell
pnpm install
pnpm dev
```

Vérification du serveur : http://127.0.0.1:5000/api/v1/health.

Le serveur peut démarrer sans MongoDB. La réponse indique alors
`database: "not_configured"`. Pour configurer l’environnement :

```powershell
Copy-Item .env.example .env
```

Renseigner `MONGO_URI` dans `.env` pour activer la connexion à la base au démarrage.
Les opérations métier utilisent des transactions : MongoDB doit fonctionner en
replica set (notamment MongoDB Atlas), même en développement.
Les valeurs par défaut sont `PORT=5000`, `HOST=127.0.0.1` et
`FRONTEND_URL=http://localhost:5173`.

```powershell
pnpm typecheck
pnpm build
pnpm start
pnpm format
pnpm format:check
```

- `src/app.ts` : configuration Express et montage de l’API sous `/api/v1`.
- `src/server.ts` : connexion à la base, démarrage et arrêt du serveur.
- `src/routes/index.ts` : regroupement des routes de chaque module.
- `src/controllers` : traitement des requêtes et réponses Express.
- `src/services` : logique métier et services de données.
- `src/models` : modèles Mongoose.
- `src/lib/database.ts` : connexion et état de MongoDB.
- `src/config/env.ts` : chargement et validation des variables d’environnement.
- `src/middlewares` : réponses aux routes inconnues et gestion des erreurs.

Les routes des niveaux scolaires, cycles, niveaux de classe, classes, élèves et
inscriptions, périodes scolaires, matières, enseignants, évaluations, notes et bulletins sont montées
sous `/api/v1`. Leur inventaire et les adaptations
d'EduGestion sont décrits dans [MODULE_ACTIONS.md](../MODULE_ACTIONS.md).
Les routes métier exigent un compte administrateur actif et vérifié.

`/api/v1/etablissement` gère l'unique fiche d'identité et les images des documents :
lecture, existence, état/version, sauvegarde complète, modification partielle,
ajout/retrait du logo et du bandeau, suppression logique et reconfiguration.
Les images PNG/JPEG/WebP sont envoyées en multipart et limitées à 128 Ko chacune.
Les routes `/etablissement/images/:kind` sont des alias des opérations médias :
`PUT` reçoit `file`, `operationId` et `revision` ; `DELETE` reçoit les deux derniers
champs en JSON. La lecture privée renvoie `{ image, revision }`.
`DELETE /etablissement/batch` accepte uniquement `ids: ['school']` et une version.
La suppression de cette fiche ne supprime aucune donnée scolaire.

Le module `/api/v1/bulletins` comprend les consultations ciblées, créations
individuelles et par classe, sauvegardes de vie scolaire/commentaires, calculs
par lot, rangs, configuration de calcul, suppressions et restauration.
Les rangs et récapitulatifs annuels sont calculés à la lecture à partir des seuls
résultats complets à jour, en séparant les années scolaires. Les résultats ne
sont jamais acceptés depuis le client dans une requête de sauvegarde.

```powershell
pnpm test
pnpm test:integration
```

`test` vérifie les contrats des routes et le SDK de stockage sur un serveur HTTP
local. `test:integration` démarre un replica set
temporaire et un serveur HTTP sur des ports libres. Il utilise une base de test
au nom aléatoire et ne se connecte pas à `MONGO_URI`.

Les tests d'intégration nécessitent un exécutable MongoDB 7.0 déjà disponible :

```powershell
$env:MONGOMS_SYSTEM_BINARY = 'C:\outils\mongodb\bin\mongod.exe'
pnpm test:integration
```

Sur Windows, le fichier local
`node_modules/.cache/mongodb-binaries/mongod-7.0.14.exe` est également reconnu.
Aucun téléchargement automatique volumineux n'est lancé par cette suite.

## Configuration des images et première connexion

Renseigner dans le fichier local `.env` :

- `MONGO_URI` : MongoDB avec transactions disponibles.
- `JWT_SECRET` : secret aléatoire d'au moins 32 caractères.
- `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` : configuration serveur uniquement.
- `SUPABASE_MEDIA_BUCKET` : facultatif, `cpeg-media-private` par défaut.

Le service crée le bucket privé s'il est absent et refuse d'utiliser un bucket
public. Ne pas placer la clé de service dans le frontend. Les images passent par
l'API authentifiée, sans URL publique. Le nettoyage des anciens fichiers est
différé et réessayé ; il ne retire pas un objet encore référencé en base.

Pour créer le premier administrateur dans la base configurée :

```powershell
pnpm admin:create
```

La commande demande email, nom et mot de passe masqué d'au moins 12 caractères.
Elle crée un compte actif et vérifié, sans modifier un compte existant. Si le
secret de session manque, elle le génère dans `.env` ; redémarrer alors le backend.
Se connecter ensuite à `/auth/login` dans le frontend. Le JWT dure 30 minutes.

Le moteur `/api/v1/media` permet association de dossier, lecture privée, upload,
remplacement, suppression unitaire/multiple et nettoyage. L'upload multiple utilise
`files` et un tableau JSON `items` en multipart. L'inventaire et les règles de
révision sont détaillés dans MODULE_ACTIONS.md.

`pnpm test:media:live` est ignoré par défaut. Pour un essai explicitement connecté
au Supabase configuré, définir `CPEG_RUN_LIVE_MEDIA_TEST=1`. Le test utilise un
MongoDB temporaire, envoie des images synthétiques et retire ses propres objets.
Il peut créer le bucket privé, mais ne crée aucun compte dans le MongoDB applicatif.

## Synchronisation des niveaux scolaires

`GET /api/v1/niveaux-scolaires/sync` retourne niveaux et archives, par pages de
100 avec `next` et le paramètre `after`. Toutes les pages sont relues à chaque
passage, ce qui prend en compte aussi les changements issus des routes CRUD.

`POST /api/v1/niveaux-scolaires/sync` reçoit `{ operationId, items }`. Chaque
élément précise `localId`, `targetId` si lié au cloud, `version`, `action` (`save`
ou `delete`) et `data` pour une sauvegarde. Le lot de 1 à 100 éléments est atomique.
La réponse contient le même `operationId` et les fiches acquittées associées aux
UUID locaux. Une suppression sans cible cloud acquitte une création locale annulée.
Les mutations et leur accusé sont dans la même transaction MongoDB. Un UUID ne
peut pas servir à un autre contenu ou compte. Aucun TTL ne supprime les accusés.

Les routes exigent l'administrateur actif et vérifié. Les versions, noms uniques,
archives et dépendances sont contrôlés avant validation. Le protocole ne restaure
pas implicitement une archive. Les cycles disposent désormais du protocole ci-dessous.

## Synchronisation des cycles

`GET /api/v1/cycles/sync` inclut les archives, avec pages de 100 et curseur `after`.
`POST /api/v1/cycles/sync` reçoit `{ operationId, items }`, selon le même protocole
que les niveaux. Pour `save`, `data` contient `nom` et `niveauScolaireId` (ObjectId
cloud du parent). Le backend refuse un parent absent/archivé, un déplacement de
cycle existant ou une version obsolète. Le nom reste unique dans son niveau scolaire.

Les mutations et accusés sont transactionnels et réessayables sans doublon.
Un lot de suppression est atomique, avec contrôle des niveaux de classe, classes
et matières liés. La sauvegarde verrouille le parent pour empêcher une création
concurrente à sa suppression ; la route classique de création emploie le même
verrou. Les accusés n'ont pas de TTL. Le contrôle administrateur s'applique à
toutes ces routes. L'inventaire détaillé est dans MODULE_ACTIONS.md.

## Synchronisation des niveaux de classe

`GET /api/v1/niveaux-classes/sync` inclut les archives, avec pages de 100 et curseur
`after`. `POST /api/v1/niveaux-classes/sync` reçoit `{ operationId, items }`. Pour
`save`, `data` contient `nom` et `cycleId` (ObjectId cloud). Le niveau scolaire est
déduit du cycle dans la transaction ; un champ `niveauScolaireId` fourni par le
client est refusé. Cycle et niveau scolaire doivent être actifs et cohérents.

Versions, rattachement fixe, nom unique dans le cycle et archives sont contrôlés.
Les suppressions multiples restent atomiques et protègent classes et matières.
La création classique de niveaux de classe et celle de classes prennent aussi un
verrou sur leur parent afin d'empêcher des orphelins pendant une suppression.
Les accusés sont persistants, liés au contenu et à l'auteur ; la reprise du même
UUID ne répète pas les mutations. Toutes les routes exigent l'administrateur actif
et vérifié. Voir MODULE_ACTIONS.md pour l'inventaire et les limites.

## Synchronisation des autres modules

Le même protocole GET/POST `/sync` couvre classes, élèves (`/students`), périodes,
matières, enseignants (`/teachers`), évaluations, inscriptions, notes et bulletins.
Les singletons utilisent `/etablissement/sync` (clé `school`) et
`/bulletins/config/sync` (clé `default`). Les contrôleurs restent Express ; les
services de synchronisation appellent les services métier dans une transaction
commune avec l’accusé (`lib/withTransaction.ts`). Les imports TypeScript restent
sans extension. Les routes classiques et leurs actions spécifiques sont conservées.

Les transferts groupent désactivation et activation, y compris après plusieurs
transferts hors connexion. Les notes clôturées restent protégées. Les bulletins
sont calculés avec les notes du serveur ; les saisies concurrentes sont contrôlées
séparément des invalidations de calcul. Les restaurations de bulletins restent
explicites. Les métadonnées d’établissement ne transportent pas les images.

`pnpm test:integration` exécute 82 tests sur un MongoDB temporaire en replica set,
dont des scénarios utilisant les services frontend et leur IndexedDB simulé.
Les données applicatives ne sont pas utilisées. Installer aussi les dépendances
frontend pour ces scénarios ; les projets restent indépendants, sans monorepo.
`pnpm test` vérifie les routes protégées et le SDK de stockage.

La PWA et les protections frontend sont décrites dans [PWA.md](../PWA.md) et
[ACCESS_SECURITY.md](../ACCESS_SECURITY.md). Les tests isolés ne valident pas
le déploiement ; la recette interactive dans un navigateur reste à effectuer.

## Identité et autorisation hors connexion

`POST /auth/login` accepte les comptes admin, teacher et student actifs et vérifiés.
`GET /auth/me` exige une session valide pour l’identité courante. Toutes les API
scolaires existantes restent réservées aux administrateurs ; la connexion des autres
rôles ne leur ouvre pas ces API.

`POST /auth/offline-access` signe une autorisation ES256 de sept jours au maximum,
pour le compte vérifié par le middleware. Le frontend la protège avec son mot de
passe local. Elle ne peut pas servir de JWT cloud. Le serveur crée sa clé privée
à la première demande dans `.local/offline-auth.pem`, ignoré par Git ; conserver
ce fichier sur un volume persistant protégé. `OFFLINE_AUTH_KEY_FILE` et
`OFFLINE_AUTH_PRIVATE_KEY` permettent une configuration de déploiement dédiée.
Les tests utilisent une clé temporaire synthétique.

Les valeurs sensibles ont été retirées de `.env.example`. Les anciens secrets
qui y figuraient doivent être renouvelés ; renseigner uniquement le vrai `.env`
ou le gestionnaire de secrets. Aucun compte réel n’a été créé par ces travaux.

## Préparer la migration Firestore

Les commandes de migration sont locales au backend :

- `pnpm migration:export --project mesnotes-edab2` : export JSON en lecture seule,
  paginé par 100 documents, avec contrôle des types et empreinte SHA-256.
- `pnpm migration:audit --input CHEMIN/firestore.json` : vérification de l'export
  et relevé des anomalies, doublons et références absentes.
- `pnpm migration:plan-identities --input CHEMIN/firestore.json` : propositions
  d'identités validées par les schémas actuels, avec dépendances conservées.
- `pnpm migration:target-inventory` : inventaire MongoDB sans écriture ni création
  d'index. Cette commande utilise la configuration locale de connexion.
- `pnpm test:migration` : tests isolés des outils de préparation.
- `pnpm migration:import --input CHEMIN/firestore.json --year 2025-2026 --preserve-unknown-births --preserve-unknown-sex --defer-conflicting-assignments` : simulation contrôlée ; ajouter `--apply` pour l'import transactionnel.
- `pnpm test:migration:import` : import sur MongoDB temporaire, annulation,
  relance et récupération des historiques vers IndexedDB via l'API Express.

La clé privée se place dans `.local/firebase-service-account.json`. Les exports et
rapports privés restent dans `.local/`, ignoré par Git. Seule la commande
`migration:import --apply` écrit les données pédagogiques de migration dans MongoDB.
Voir [MIGRATION_FIRESTORE.md](../MIGRATION_FIRESTORE.md) pour les règles et les limites.

La reprise des comptes enseignants est documentée dans
[AUTH_MIGRATION.md](AUTH_MIGRATION.md). Les commandes `migration:auth:export` et
`migration:auth:import` permettent de conserver les anciens mots de passe sans
utiliser Firebase lors des connexions. Seul `migration:auth:import --apply` écrit
les nouveaux comptes et leurs rattachements dans MongoDB ; la simulation est en
lecture seule.
