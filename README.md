# Lockey

Gestionnaire de mots de passe **auto-hébergé** et **à connaissance nulle**
(*zero-knowledge*) — dans l'esprit de Dashlane / Bitwarden / KeePass, mais dont
vous maîtrisez le code et l'hébergement de bout en bout.

Le serveur ne stocke que des données chiffrées. Les clés de déchiffrement sont
dérivées de votre mot de passe maître **dans le navigateur** et n'en sortent
jamais : même un accès complet à la base de données ne révèle aucun secret.

---

## Fonctionnalités

- 🔐 **Chiffrement de bout en bout** — mot de passe maître → PBKDF2 (600 000
  itérations) → clé de chiffrement AES-256-GCM. Le serveur ne voit jamais le mot
  de passe ni les contenus.
- 📁 **Stockage typé** — identifiants de sites, notes sécurisées, cartes
  bancaires, identités, clés API. Recherche, filtres, favoris.
- 🎲 **Générateur** — mots de passe aléatoires et phrases de passe, avec
  indicateur de robustesse.
- 🔑 **2FA TOTP intégré** — stockez la clé 2FA d'un compte et obtenez le code à
  6 chiffres en direct, avec décompte.
- 📊 **Audit de sécurité** — tableau de bord « santé » : mots de passe faibles,
  réutilisés, anciens, comptes sans 2FA, score global.
- 🛟 **Récupération** — code de récupération généré à l'inscription (seule
  porte de secours si le mot de passe maître est oublié).
- 👆 **Déverrouillage par passkey** — WebAuthn + extension PRF (empreinte,
  Face ID, clé de sécurité), en complément du mot de passe maître.
- 🛡 **2FA du compte** — TOTP + codes de secours pour la connexion.
- 📋 **Journal d'audit** — chaîné par HMAC clavé (clé hors base) : inviolable
  sans cette clé, même avec un accès complet à la base.
- 👥 **Multi-utilisateurs** — rôles administrateur / utilisateur.

---

## Architecture du chiffrement

```
mot de passe maître ──PBKDF2(sel = username, 600 000 itér.)──▶ clé maître (256 bits)
                              │
                ┌─────────────┴───────────────┐
           authHash                        encKey (HKDF)
   (PBKDF2, 1 itér. — envoyé              (clé AES-GCM — reste
    au serveur, qui en stocke              dans le navigateur)
    un bcrypt)                                   │
                                                 ▼
                                  emballe la clé de chiffrement
                                       (AES-256 aléatoire)
                                                 │
                                                 ▼
                          chaque élément stocké est chiffré
                                en AES-256-GCM avec elle
```

- Le serveur reçoit uniquement `authHash` (preuve de connaissance du mot de
  passe) et `protectedVaultKey` (la clé de chiffrement **emballée**). Il ne peut
  rien déballer.
- La **clé de chiffrement** est générée aléatoirement une seule fois. Changer de
  mot de passe maître ne fait que la ré-emballer — les données chiffrées et le
  code de récupération restent valables.
- Le **code de récupération** (~125 bits) emballe une seconde copie de la clé
  de chiffrement : il permet de reprendre la main sans le mot de passe maître.
- Conséquence directe : **si le mot de passe maître ET le code de récupération
  sont perdus, les données sont irrécupérables** — par conception.

Détails dans `client/src/crypto/zk.ts`.

---

## Pile technique

| | |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router |
| Backend | Node.js 20+, Express, TypeScript |
| Base de données | PostgreSQL 14+ via Prisma |
| Cryptographie | Web Crypto API (PBKDF2, HKDF, AES-256-GCM, HMAC-SHA1) |
| Auth | JWT en cookie httpOnly, 2FA TOTP, WebAuthn/passkey |

---

## Prérequis

- Node.js ≥ 20
- PostgreSQL ≥ 14
- Un contexte **HTTPS** en production (obligatoire pour les passkeys et
  recommandé pour les cookies de session).

---

## Installation

### 1. Base de données

Créez une base PostgreSQL et notez son URL de connexion.

### 2. Serveur

```bash
cd server
npm install
cp .env.example .env   # puis éditez .env (voir variables ci-dessous)
npm run prisma:generate
npm run prisma:migrate    # applique le schéma
npm run build
npm start
```

En développement : `npm run dev` (rechargement à chaud).

### 3. Client

```bash
cd client
npm install
npm run build             # génère client/dist, servi par le serveur
```

En développement : `npm run dev` (Vite, proxy vers le serveur sur le
port 3000).

### 4. Premier démarrage

À la première visite, l'assistant d'installation crée le compte
administrateur initial et affiche son **code de récupération** — conservez-le
hors ligne immédiatement.

---

## Variables d'environnement (serveur)

| Variable | Requis | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | URL de connexion PostgreSQL |
| `JWT_SECRET` | ✅ | Secret de signature des sessions. ≥ 32 caractères **aléatoires** (entropie validée au boot). |
| `VAULT_MASTER_KEY` | ✅\* | Chiffre les secrets 2FA au repos. \*Obligatoire dès qu'un utilisateur active le 2FA (le serveur refuse de booter sinon). |
| `AUDIT_HMAC_KEY` | — | Clé HMAC du journal d'audit (intégrité). À défaut, dérivée de `JWT_SECRET`. Une clé dédiée découple la rotation de session de l'audit. |
| `SMTP_ENCRYPTION_KEY` | ✅\*\* | Chiffre le mot de passe SMTP au repos. \*\*Obligatoire pour enregistrer un mot de passe SMTP (plus de fallback `JWT_SECRET`). |
| `JWT_EXPIRES_IN` | — | Durée de session (défaut : `12h`) |
| `HOST` / `PORT` | — | Interface d'écoute (défaut : `127.0.0.1:3000`) |
| `CORS_ORIGIN` | — | Origines autorisées (si le front est servi séparément) |
| `TRUST_PROXY` | — | Configuration proxy Express (défaut : `loopback`) |
| `NODE_ENV` | — | `production` (défaut) / `development` / `test` |
| `LOG_LEVEL` | — | `info` (défaut), `debug`, etc. |

Générer chaque secret : `openssl rand -base64 48`. Le serveur **refuse de
démarrer** si une clé contient `CHANGE_ME` ou a une entropie triviale.

---

## Structure du projet

```
client/                  Application React (SPA)
  src/
    crypto/               Cryptographie zéro-connaissance (zk.ts, passkey.ts)
    vault/                Modèle, chiffrement et audit des éléments stockés
    pages/                Écrans (Lockey, déverrouillage, récupération…)
    components/           Composants partagés (générateur, TOTP, modales…)
    auth/                 Contexte d'authentification et gardes de routes
server/
  src/
    routes/               Endpoints HTTP (auth, account, vault, users…)
    utils/                Chiffrement côté serveur (secrets 2FA, SMTP)
    services/             Healthchecks, email
  prisma/schema.prisma    Schéma de base de données
```

---

## Modèle de sécurité

- Le serveur **au repos ne peut pas** déchiffrer les données : il ne stocke que
  des hashes (`bcrypt`) et des blobs chiffrés. Un vol de la base ne révèle aucun
  secret.
- Le mot de passe maître et le code de récupération ne transitent jamais en
  clair.
- La clé de chiffrement vit uniquement en mémoire du navigateur ; elle est perdue à
  chaque rechargement (→ écran de déverrouillage) et après inactivité
  prolongée (verrouillage automatique).
- Un administrateur **ne peut pas** réinitialiser le mot de passe d'un autre
  utilisateur (ce serait incompatible avec le chiffrement zéro-connaissance) —
  la récupération passe par le code de récupération de l'utilisateur.
- Le journal d'audit est chaîné par **HMAC-SHA256 clavé** (clé hors base) :
  un porteur d'accès à la base ne peut pas recalculer une chaîne cohérente
  après altération. Vérification : `npm run verify:audit-chain`.

### Limite à connaître — zéro-connaissance *servi par le web*

Le zéro-connaissance protège la base **au repos**. Mais comme Lockey **sert
lui-même** le JavaScript qui chiffre dans le navigateur, un serveur **compromis
en exécution** (ou un administrateur malveillant) pourrait servir un code piégé
qui capture le mot de passe maître à la saisie. C'est la limite intrinsèque de
tout coffre zéro-connaissance livré via le web (Bitwarden/Proton « web vault »
incluses), distincte d'une extension/app à code signé. Atténuations : HTTPS
strict, CSP verrouillée (en place), et — pour les profils à risque élevé —
préférer un déploiement de confiance que vous maîtrisez de bout en bout.

---

## Scripts utiles (serveur)

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur en développement (hot reload) |
| `npm run build` | Compilation TypeScript |
| `npm start` | Démarrage en production |
| `npm test` | Tests unitaires (Vitest) |
| `npm run prisma:migrate` | Applique les migrations de schéma |
| `npm run prisma:studio` | Explorateur de base de données |
| `npm run verify:audit-chain` | Vérifie l'intégrité du journal d'audit |

---

## Licence

MIT Licence
