# Backend - Preço Certo

API Node/Express usada no Render.

## Rodar local

```bash
npm install
npm start
```

## Variáveis

Use `backend/.env` com:

- `PORT`
- `NODE_ENV`
- `CORS_ALLOWED_ORIGINS`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `BACKUP_ENABLED`
- `REQUIRE_USER_CONTEXT`

## Rotas principais

- `/api/health`
- `/api/clientes`
- `/api/renovacoes`
- `/api/servidores`
- `/api/revendedores`
- `/api/mensagens`
- `/api/precificacao`
- `/api/recebiveis`
- `/api/configuracoes`
