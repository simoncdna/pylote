# Pylote — PWA de contrôle ON/OFF d'un LXC Proxmox

**Date :** 2026-07-23
**Statut :** Design validé (brainstorming)

## Objectif

Pouvoir allumer / éteindre depuis le téléphone (via une PWA installable) le LXC
Proxmox qui héberge le serveur de jeu **Enshrouded**. Le téléphone accède au
réseau local via un **VPN**, ce qui permet à la PWA de joindre directement une IP
locale en HTTP.

Périmètre v1 : contrôle du **LXC entier** via l'API Proxmox (start / stop /
status). Le contrôle fin du conteneur Docker *à l'intérieur* du LXC est
explicitement **hors périmètre v1** (voir « Évolutions futures »).

## Contraintes & décisions

- **Une PWA seule ne peut pas** parler à Proxmox (pas de SSH/socket, certificat
  auto-signé, CORS, et il ne faut pas exposer le token Proxmox dans le
  navigateur). → il faut un backend.
- **Monolithe** : un seul service backend qui sert la PWA (fichiers statiques
  buildés) **et** expose l'API. Un seul port, un seul déploiement.
- Le backend **ne doit pas** tourner dans le LXC qu'il contrôle (sinon il
  s'éteindrait lui-même et ne pourrait plus rallumer le LXC). → il tourne dans un
  LXC séparé **always-on** déjà existant, nommé **`app`**.
- **Auth** : secret partagé (header `X-Auth-Token`). Le VPN reste la première
  barrière ; le secret empêche les appels accidentels/non voulus depuis le LAN.
- **Stack** : **Bun + Hono + React/Vite**, 100 % **TypeScript**.

## Architecture

```
[Téléphone / PWA React]
        |
        |  VPN → HTTP local, header X-Auth-Token
        v
[LXC "app" (always-on) : monolithe Bun + Hono]
        |  sert la PWA (statique) + API /api/*
        |
        |  API Proxmox (token, HTTPS)
        v
[Nœud Proxmox]  --->  start / stop / status du LXC Enshrouded (VMID)
```

Un seul processus Bun. En dev, Vite tourne à part avec un proxy vers le backend ;
en prod, Bun sert le build statique de la PWA.

## Composants

### 1. Client Proxmox (`src/server/proxmox.ts`)
Rôle : encapsuler tous les appels à l'API Proxmox. Seule partie qui connaît le
format de l'API Proxmox.
- `getStatus()` → interroge `GET /api2/json/nodes/{node}/lxc/{vmid}/status/current`,
  renvoie un état normalisé (`running` | `stopped` | `unknown`).
- `start()` → `POST .../status/start`.
- `stop()` → `POST .../status/shutdown` (arrêt propre ; `stop` = coupure brutale,
  réservé à un éventuel usage futur).
- Authentification : header `Authorization: PVEAPIToken=<tokenId>=<secret>`.
- Le certificat Proxmox étant souvent auto-signé, le client Bun `fetch` doit
  tolérer le certificat (option TLS `rejectUnauthorized: false` ou équivalent
  Bun) — **côté serveur uniquement**, jamais dans le navigateur.
- Dépend de la config (variables d'environnement). Testable en isolant `fetch`
  (mock).

### 2. API HTTP (`src/server/app.ts`)
Rôle : exposer une API minimale et scoppée, gérer auth + erreurs, servir la PWA.
- Middleware auth : rejette `401` si `X-Auth-Token` ≠ `AUTH_TOKEN`.
- Middlewares : CORS, logger.
- Routes :
  - `GET  /api/status` → `{ state: "running" | "stopped" | "unknown" }`
  - `POST /api/start`  → déclenche le start, `{ ok: true }`
  - `POST /api/stop`   → déclenche le shutdown, `{ ok: true }`
  - `GET  /api/health` → `{ ok: true }` (sans auth, pour vérifier que le service tourne)
  - `GET  /*`          → fichiers statiques de la PWA
- Ne contient aucune logique Proxmox directe : délègue au client Proxmox.

### 3. Frontend PWA (`src/client/`)
Rôle : une page unique pour voir l'état et toggler.
- Un badge d'état : `running` (vert) / `stopped` (gris) / `pending` (transition) /
  `error`.
- Un gros bouton **toggle ON/OFF** (désactivé pendant une transition).
- **Polling** de `GET /api/status` toutes les ~5 s pour refléter l'état réel
  (y compris quand le démarrage/arrêt prend du temps).
- Champ pour saisir le **secret partagé**, mémorisé en `localStorage`, envoyé en
  header sur chaque requête.
- Config PWA via `vite-plugin-pwa` : manifest (nom, icône, thème), installable,
  shell offline (l'app se charge hors-ligne mais indiquera l'erreur réseau si le
  backend est injoignable).

#### Design visuel (validé)

Direction retenue : **« gaming / néon »**.

- **Thème principal : dark** (fond `#0d1117`, texte clair), avec un **light mode**
  disponible (fond clair `#f4f6f9`) — on suit `prefers-color-scheme`.
- **Accent** : vert néon (`#3fe78c` en dark, `#12b364` en light) pour l'état actif.
- **Layout** (une seule page, centré verticalement) : en haut le titre `Pylote` +
  sous-titre `Server control` ; au centre le badge d'état, le gros **bouton
  toggle rond** (~112 px), et le nom du serveur (`Enshrouded`) dessous.
- **Pas de texte d'aide** sous le bouton (l'état ON/OFF se suffit).
- **Tous les libellés d'interface sont en anglais.**
- **États visuels** (4) :
  - **ON** — badge vert `Online` (point lumineux), bouton néon vert « ON ».
  - **OFF** — badge gris `Offline`, bouton terne/éteint « OFF ».
  - **Transition** — badge jaune `Starting…` / `Stopping…` (point clignotant) ;
    le bouton émet un **anneau qui s'écarte** (façon radar/ping) et affiche **trois
    points qui rebondissent** en son centre ; bouton **non-cliquable** pendant la
    transition.
  - **Erreur** — badge rouge `Error` + message court `Proxmox unreachable`.

## Flux de données

1. La PWA lit le secret depuis `localStorage`.
2. Toutes les 5 s : `GET /api/status` (header auth) → met à jour le badge.
3. Clic sur le toggle :
   - si `stopped` → `POST /api/start` ; si `running` → `POST /api/stop`.
   - le bouton passe en `pending` ; le polling confirmera la transition réelle.
4. Le backend traduit chaque appel en requête API Proxmox et renvoie un état
   normalisé.

## Gestion des erreurs

Le backend renvoie des codes clairs, et la PWA **affiche l'erreur au lieu de
mentir sur l'état** :
- `401` → mauvais secret (la PWA invite à re-saisir le secret).
- `502` → Proxmox injoignable ou réponse invalide.
- `500` → erreur inattendue.
- La PWA affiche l'état `error` avec un message court ; le polling reprend
  automatiquement.

## Configuration (variables d'environnement)

| Variable | Rôle |
|---|---|
| `PROXMOX_URL` | ex. `https://192.168.1.10:8006` |
| `PROXMOX_TOKEN_ID` | ex. `pylote@pve!toggle` |
| `PROXMOX_TOKEN_SECRET` | le secret du token API |
| `PROXMOX_NODE` | nom du nœud, ex. `pve` |
| `LXC_VMID` | id du LXC Enshrouded, ex. `105` |
| `AUTH_TOKEN` | secret partagé attendu dans `X-Auth-Token` |
| `PORT` | port d'écoute du monolithe, ex. `3000` |

Chargées depuis un fichier `.env` (non commité ; un `.env.example` documente les clés).

## Tests

- **Client Proxmox** : tests unitaires avec `fetch` mocké — vérifient l'URL, les
  headers d'auth, et la normalisation de l'état (running/stopped/unknown, erreurs).
- **API** : tests d'intégration Hono (client Proxmox mocké) — auth 401, mapping
  des routes, codes d'erreur 502/500, health sans auth.
- **Frontend** : test léger de la logique d'état du toggle (pending/erreur) ;
  pas de sur-ingénierie sur l'UI.

## Déploiement

- **Dev** : Vite (frontend, HMR) + Bun (backend) ; Vite proxy `/api` → backend.
- **Prod** : `bun run build` (build la PWA dans `dist/`), puis Bun sert `dist/` +
  l'API. Lancement : `bun run start`.
- **Conteneurisation** : un `Dockerfile` basé sur `oven/bun` pour tourner comme
  conteneur dans le LXC `app` (ou lancement direct via Bun + un service systemd).
- `.env` fournit la config sur la machine cible.

## Prérequis Proxmox (à préparer côté utilisateur)

1. **Créer un token API** : Proxmox UI → *Datacenter → Permissions → API Tokens*
   → créer un token (ex. `pylote@pve!toggle`). Noter le **Token ID** et le
   **Secret** (affiché une seule fois).
2. **Donner les droits** au token/utilisateur sur le LXC (ou le pool) :
   `VM.PowerMgmt` (start/stop) + `VM.Audit` (lire le statut). Via
   *Datacenter → Permissions → Add*.
3. **Trouver le VMID** : c'est le numéro affiché à côté du LXC dans l'arbre
   Proxmox (ex. `105`), et le **nom du nœud** (ex. `pve`).

## Hors périmètre v1 / Évolutions futures

- Contrôle du **conteneur Docker à l'intérieur** du LXC (nécessiterait un agent
  dans le LXC ou l'exposition de l'API Docker).
- Contrôle de **plusieurs** LXC/conteneurs (liste dynamique).
- **Vrai login** multi-utilisateur (au lieu du secret partagé).
- HTTPS avec certificat propre pour le monolithe.
