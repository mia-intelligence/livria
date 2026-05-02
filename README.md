# LIVRIAL — Groupe Atrial

Application de gestion des tournées de livraison quotidiennes pour Groupe Atrial (menuiserie industrielle BtoB, Brignoles — Var).

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Node.js + fonctions serverless Vercel |
| Frontend | HTML / CSS / JavaScript vanilla |
| Cartographie | Google Maps API |
| Base de données | PostgreSQL via Supabase (EU — Frankfurt) |
| Authentification | Sessions cookie (httpOnly) + bcrypt |
| Webhook entrant | HTTP POST depuis Make |
| Déploiement V1 | Vercel |
| Migration prévue | VPS Hostinger Europe |

---

## Structure du projet

```
livrial/
├── api/
│   ├── auth/
│   │   ├── login.js        POST /api/auth/login
│   │   ├── logout.js       POST /api/auth/logout
│   │   └── me.js           GET  /api/auth/me
│   ├── stops/
│   │   ├── index.js        GET / POST /api/stops
│   │   └── [id].js         GET / PATCH / DELETE /api/stops/:id
│   ├── users/
│   │   ├── index.js        GET / POST /api/users
│   │   └── [id].js         GET / PATCH /api/users/:id
│   └── webhook/
│       └── stop.js         POST /api/webhook/stop
├── public/
│   ├── css/style.css
│   ├── js/
│   │   ├── livreur.js
│   │   ├── adv.js
│   │   └── admin.js
│   ├── images/atrial-logo.jpeg
│   ├── index.html          → Login
│   ├── livreur.html        → Vue livreur (mobile)
│   ├── adv.html            → Console ADV (desktop)
│   └── admin.html          → Administration (desktop)
├── lib/
│   ├── db.js               Connexion Supabase
│   └── auth.js             Middleware sessions
├── supabase/
│   ├── schema.sql          Tables + index + trigger
│   └── seed.sql            Données de test
├── .env.example
├── vercel.json
└── package.json
```

---

## 1. Prérequis

- Compte [Supabase](https://supabase.com) (gratuit)
- Compte [Vercel](https://vercel.com) (gratuit)
- Clé API [Google Maps](https://console.cloud.google.com) (Maps JavaScript API activée)
- Node.js ≥ 18

---

## 2. Création du projet Supabase

1. Se connecter à [app.supabase.com](https://app.supabase.com)
2. **New project** → choisir la région **Frankfurt (EU Central)**
3. Donner un nom : `livrial-atrial`
4. Récupérer dans **Settings → API** :
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`

### Initialiser la base de données

Dans **SQL Editor** de Supabase, exécuter dans l'ordre :

```sql
-- 1. Schéma (tables, index, trigger)
-- Coller le contenu de supabase/schema.sql

-- 2. Données de test (optionnel)
-- Coller le contenu de supabase/seed.sql
```

---

## 3. Variables d'environnement

Copier `.env.example` en `.env` et remplir :

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GOOGLE_MAPS_API_KEY=AIzaSy...
SESSION_SECRET=une_chaine_aleatoire_longue_de_32_caracteres_minimum
NODE_ENV=production
```

> **Google Maps** : activer "Maps JavaScript API" dans Google Cloud Console et restreindre la clé à vos domaines Vercel.

---

## 4. Déploiement Vercel

### Via l'interface web

1. Pousser le projet sur GitHub
2. Sur [vercel.com](https://vercel.com) → **Add New Project** → importer le repo
3. Dans **Environment Variables**, ajouter les 4 variables ci-dessus
4. **Deploy** — Vercel détecte automatiquement `vercel.json`

### Via CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

### Injecter la clé Google Maps dans les pages HTML

Après déploiement, les pages `livreur.html` et `adv.html` contiennent le placeholder `__GMAPS_KEY__`.  
Pour l'injecter automatiquement, ajouter ce script de build ou le remplacer manuellement :

```bash
# Exemple avec sed (en local ou dans un script CI)
sed -i '' "s/__GMAPS_KEY__/$GOOGLE_MAPS_API_KEY/g" public/livreur.html public/adv.html
```

Ou utiliser une [Vercel Edge Middleware](https://vercel.com/docs/functions/edge-middleware) pour injecter la clé dynamiquement.

---

## 5. Comptes de test

| Email | Mot de passe | Rôle |
|---|---|---|
| admin@atrial.fr | Admin123 | ADMIN |
| adv@atrial.fr | Adv123 | ADV |
| livreur@atrial.fr | Livreur123 | LIVREUR |

> Changer les mots de passe immédiatement après le premier déploiement.

---

## 6. Webhook Make (entrée)

**URL** : `https://votre-domaine.vercel.app/api/webhook/stop`  
**Méthode** : `POST`  
**Content-Type** : `application/json`

**Corps JSON attendu** :
```json
{
  "societe": "Nom de la société",
  "adresse": "12 rue des Artisans, 83000 Toulon",
  "telephone": "06 12 34 56 78",
  "latitude": 43.1242,
  "longitude": 5.9280,
  "numero_affaire": "2026-089",
  "type": "ATRIAL"
}
```

Valeurs acceptées pour `type` : `ATRIAL` | `ENLEVEMENT` | `TRANSPORTEUR`

**Réponse** :
- `200 { "ok": true, "id": "uuid" }` — stop créé
- `400 { "error": "..." }` — données manquantes ou invalides

---

## 7. Rôles et redirections

| Rôle | Redirection après login | Accès |
|---|---|---|
| LIVREUR | `/livreur` | Stops ATRIAL du jour uniquement |
| ADV | `/adv` | Tous les stops, gestion de la tournée |
| ADMIN | `/admin` | Gestion des utilisateurs |

---

## 8. Migration vers VPS Hostinger (production)

### Prérequis VPS

- Ubuntu 22.04 LTS
- Node.js 20 LTS (`nvm install 20`)
- PM2 (`npm install -g pm2`)
- Nginx (reverse proxy)
- Certbot (SSL Let's Encrypt)

### Étapes

```bash
# 1. Cloner le projet
git clone https://github.com/votre-org/livrial.git /var/www/livrial
cd /var/www/livrial

# 2. Installer les dépendances
npm install --production

# 3. Créer le fichier .env
cp .env.example .env
nano .env  # remplir les variables

# 4. Créer un serveur Express wrapper (server.js)
# Le projet utilise le format Vercel serverless.
# Créer un adapter Express pour VPS (voir section 8b).

# 5. Lancer avec PM2
pm2 start server.js --name livrial
pm2 startup && pm2 save

# 6. Configurer Nginx
# Voir template nginx.conf ci-dessous

# 7. SSL
certbot --nginx -d livrial.votre-domaine.fr
```

### Template Nginx (livrial.conf)

```nginx
server {
    listen 80;
    server_name livrial.votre-domaine.fr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name livrial.votre-domaine.fr;

    ssl_certificate     /etc/letsencrypt/live/livrial.votre-domaine.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livrial.votre-domaine.fr/privkey.pem;

    root /var/www/livrial/public;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Adapter Express pour VPS (server.js à créer)

```js
// server.js — wrapper Express pour VPS Hostinger
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Monter les routes API
const handlers = {
  '/api/auth/login':   require('./api/auth/login'),
  '/api/auth/logout':  require('./api/auth/logout'),
  '/api/auth/me':      require('./api/auth/me'),
  '/api/stops':        require('./api/stops/index'),
  '/api/webhook/stop': require('./api/webhook/stop'),
};

Object.entries(handlers).forEach(([path, handler]) => {
  app.all(path, handler);
});

// Routes dynamiques
app.all('/api/stops/:id', require('./api/stops/[id]').bind(null));
app.all('/api/users/:id', require('./api/users/[id]').bind(null));
app.all('/api/users',     require('./api/users/index'));

app.listen(process.env.PORT || 3000, () => {
  console.log('LIVRIAL démarré sur le port', process.env.PORT || 3000);
});
```

---

## 9. Sécurité

- HTTPS obligatoire (géré par Vercel / Certbot)
- Mots de passe hashés bcrypt (salt 10)
- Sessions httpOnly, secure, sameSite=strict, TTL 8 heures
- Révocation immédiate : session invalidée côté serveur
- Aucune donnée personnelle sensible (BtoB uniquement)
- Hébergement UE (RGPD)
- Conservation des stops : 12 mois glissants

---

## 10. Périmètre V1

**Inclus** : Login · Vue Livreur mobile · Console ADV · Administration utilisateurs · Webhook Make

**V2 (post-terrain)** : Reporting · Gestion anomalies avec photos · SMS clients · Bons de livraison signés · Multi-livreurs
