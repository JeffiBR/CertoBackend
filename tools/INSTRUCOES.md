# Instrucoes de Deploy Separado

## Objetivo

- Backend no Render.
- Frontend no GitHub Pages, em repositorio separado.

## Backend (Render)

1. Suba este backend para um repositorio proprio (exemplo: `preco-certo-backend`).
2. No Render, crie um `Web Service` apontando para esse repositorio.
3. Configure:
   - `Build Command`: `npm install`
   - `Start Command`: `npm start`
   - `Health Check`: `/api/health`
4. Variaveis no Render:
   - `NODE_ENV=production`
   - `CORS_ALLOWED_ORIGINS=https://SEU-USUARIO.github.io`
   - `GITHUB_TOKEN=<seu_token>`
   - `GITHUB_OWNER=JeffiBR`
   - `GITHUB_REPO=Dados`
   - `GITHUB_BRANCH=main`
   - `BACKUP_ENABLED=true`
   - `REQUIRE_USER_CONTEXT=true`

## Frontend (GitHub Pages)

1. Crie outro repositorio (exemplo: `preco-certo-frontend`).
2. Copie o conteudo da pasta `public/` para esse repositorio.
3. Em `config.js`, ajuste:
   - `window.API_BASE = 'https://SEU-BACKEND.onrender.com/api';`
   - `window.CLERK_PUBLISHABLE_KEY = 'pk_live_xxxxx';`
   - `window.CLERK_ENABLED = true;`
4. Ative GitHub Pages (branch `main`, pasta `/root`).

## Isolamento e backup

- Cada usuario usa seu proprio namespace em `users/<user-id>/...`.
- Backup diario automatico em `users/<user-id>/_backup/YYYY-MM-DD/...`.
- Sem usuario logado (header `X-User-Id`), a API retorna `401`.

## Checklist

- Backend responde `GET /api/health` no Render.
- Frontend abre no GitHub Pages.
- Chamadas para `/api/...` funcionam sem erro de CORS.
