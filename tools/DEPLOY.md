# Deploy Separado (Backend + Frontend)

## 1) Backend no Render (este repositório)

Use:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Variáveis no Render:
- `NODE_ENV=production`
- `REQUIRE_USER_CONTEXT=true`
- `CORS_ALLOWED_ORIGINS=https://SEU-USUARIO.github.io`
- `GITHUB_TOKEN=...`
- `GITHUB_OWNER=JeffiBR`
- `GITHUB_REPO=Dados`
- `GITHUB_BRANCH=main`
- `BACKUP_ENABLED=true`

Depois do deploy, copie a URL da API:
- `https://SEU-BACKEND.onrender.com/api`

## 2) Frontend em outro repositório (GitHub Pages)

No repositório do frontend, publique os arquivos de `public/` (HTML/CSS/JS).

Em `public/config.js`, configure:
- `window.API_BASE = 'https://SEU-BACKEND.onrender.com/api'`
- `window.CLERK_PUBLISHABLE_KEY = 'pk_live_...'`
- `window.CLERK_ENABLED = true`

## 3) CORS e domínio do Pages

Se usar domínio customizado no frontend, adicione ele em `CORS_ALLOWED_ORIGINS`.

Exemplo:
- `CORS_ALLOWED_ORIGINS=https://SEU-USUARIO.github.io,https://app.seudominio.com`

## 4) Checklist final

- Backend Render responde em `/api/health`.
- Frontend aponta para `API_BASE` correta.
- Login Clerk ativo.
- Chamadas da API retornam dados do usuário logado (sem 401).

