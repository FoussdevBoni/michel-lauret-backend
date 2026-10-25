# Reprise des accès enseignants sans Firebase

Le serveur Express authentifie les enseignants avec MongoDB. Aucune connexion
Firebase, aucun SDK Firebase et aucun compte de service ne sont nécessaires au
fonctionnement de la connexion ou de l'espace enseignant. Le SDK installé en
dépendance de développement sert uniquement aux outils d'export historiques.

## Actions disponibles

- `pnpm migration:auth:export --project ID` : lecture des comptes Firebase et des
  paramètres de hachage, sans aucune écriture Firebase ou MongoDB.
- `pnpm migration:auth:import --input CHEMIN/accounts.json --config
CHEMIN/hash-config.json --project ID` : simulation et vérification, sans modifier
  MongoDB ou la configuration locale.
- La même commande avec `--apply` prépare le fichier privé de configuration et
  importe transactionnellement les comptes enseignants admissibles.
- Une nouvelle simulation vérifie les rattachements et les empreintes importées.
  Une nouvelle application préserve les comptes déjà importés, même après changement
  de leur mot de passe ou de leur statut.

Les exports et les rapports détaillés sont dans `.local/auth-migration/`, exclus
du suivi de code. Ils contiennent des données confidentielles et ne doivent pas
être placés dans le frontend, un répertoire public, un ticket ou des journaux.
Les commandes n'affichent que les compteurs et le chemin du rapport privé.

## Correspondances et exceptions

L'import utilise exclusivement une migration Firestore terminée du projet attendu,
ses archives de dossiers enseignants et sa correspondance vers les identifiants
MongoDB. L'adresse historique doit correspondre à un unique dossier cible encore
disponible. Aucun rapprochement par le nom, aucune création de dossier pédagogique,
aucun changement des classes et matières affectées.

Les comptes non enseignants, doublons, dossiers modifiés ou supprimés, comptes
locaux préexistants et comptes exigeant une vérification MFA ne sont pas rattachés
automatiquement. Un compte Firebase désactivé reste inactif. Une empreinte absente
ou incompatible exige une réinitialisation distincte : aucun mot de passe n'est
inventé par l'import.

Le rôle est toujours `teacher`. L'accès pédagogique est approuvé par le dossier
historique enregistré, comme dans l'ancien logiciel. Le champ local `isVerified`
signifie ici que le compte peut accéder à l'application ; il ne prétend pas que
Firebase avait vérifié son adresse e-mail.

## Connexion et conversion

L'enseignant utilise la page de connexion existante, avec son adresse et son mot
de passe habituels. L'empreinte historique est vérifiée localement avec le format
Firebase SCRYPT : scrypt et AES-256-CTR, comparaison en temps constant. Le vecteur
public officiel et les représentations base64url du SDK sont couverts par les tests.

Après une connexion réussie, une mise à jour conditionnelle remplace l'empreinte
historique par bcrypt d'une préempreinte SHA-256 du mot de passe. Cette préempreinte
évite la troncature bcrypt des mots de passe dépassant 72 octets. Les anciens
comptes locaux bcrypt restent compatibles ; les nouveaux mots de passe et les
réinitialisations utilisent le format indiqué par `passwordFormat`.

L'ancienne empreinte et son sel sont retirés du compte lors de la conversion ou
d'une réinitialisation. Une suspension ou une réinitialisation concurrente ne peut
pas être annulée par une conversion retardée. Deux connexions simultanées sont
prises en charge. Les champs secrets sont exclus des lectures usuelles et des
réponses JSON. La création d'une session, les permissions et l'accès hors connexion
restent ceux du système existant. La première connexion nécessite le backend en
ligne ; les autorisations hors connexion sont ensuite préparées normalement.

## Déploiement

Le fichier privé `.local/legacy-password-hash-config.json` contient les paramètres
nécessaires aux comptes qui n'ont pas encore été convertis. L'import le prépare et
renseigne `LEGACY_PASSWORD_HASH_CONFIG_PATH` dans le fichier local `.env`, sans
modifier les autres paramètres. Le chemin par défaut est résolu depuis le dossier
du backend ; un chemin absolu fourni par le déploiement est préférable en production.

Lors du déploiement, fournir ce fichier via un volume privé persistant ou un
gestionnaire de secrets, et configurer son chemin sur le serveur. Il contient une
clé sensible : ne pas le committer ni le servir au navigateur. Un fichier absent,
altéré ou appartenant à un autre export empêche les connexions historiques avec
une erreur explicite ; les comptes déjà convertis continuent à fonctionner.

Conserver ces paramètres jusqu'à conversion ou réinitialisation de tous les
comptes historiques. Le compte de service et les exports n'ont pas à être déployés.
La suppression de l'ancien projet Firebase reste une opération distincte ; aucun
projet, compte ou document Firebase n'est supprimé par cette migration.

## Exécution réelle du 18 octobre 2026

- 36 comptes source exportés en lecture seule, paramètres de hachage disponibles.
- 18 comptes enseignants importés, avec conservation des empreintes et rattachement
  aux dossiers existants.
- 16 comptes sans dossier enseignant migré exclus de cet import.
- Deux comptes source portent la même adresse `latifoukpara@gmail.com` : accès de
  cet enseignant laissé en attente de vérification, à la demande de l'utilisateur.
- Aucun mot de passe réel demandé, affiché ou utilisé pour tester une connexion.
- Les tests utilisent un vecteur public et une base MongoDB isolée, jamais la base
  réelle. Les contrôles après import réel portent sur les comptes, les liens et
  les empreintes, sans ouvrir de session à la place des enseignants.

Validation : 17 tests dédiés réussis (12 scénarios MongoDB et 5 contrôles
cryptographiques), 48 tests backend réussis (dont les 5 contrôles cryptographiques),
8 scénarios HTTP de connexion, accès hors connexion et espace enseignant réussis.
Compilation TypeScript et construction du serveur réussies. Contrôle après
import réel : 18 comptes rattachés, 18 empreintes conservées, aucune anomalie.

Sources de référence : [format officiel et vecteur](https://github.com/firebase/scrypt),
[export des comptes](https://firebase.google.com/docs/cli/auth),
[droits d'export des empreintes](https://firebase.google.com/docs/auth/admin/manage-users#password_hashes_of_listed_users).
