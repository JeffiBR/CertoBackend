require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { storage } = require('./githubStorage');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRE_USER_CONTEXT = String(process.env.REQUIRE_USER_CONTEXT || 'true').toLowerCase() !== 'false';

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '*') return '*';
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return raw.replace(/\/+$/, '');
  }
}

function getAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.AUTH_CORS_ALLOWED_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

  if (origins.length > 0) return origins;
  if (NODE_ENV === 'production') return [];
  return ['http://localhost:3000', 'http://127.0.0.1:3000'];
}

const allowedOrigins = getAllowedOrigins();

// =============================================
// MIDDLEWARES
// =============================================

// CORS configurado para permitir origens definidas em CORS_ALLOWED_ORIGINS
app.use(cors({
  origin(origin, callback) {
    // Permite tools/scripts sem Origin (curl, postman, health checks)
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    // Em dev, sem CORS_ALLOWED_ORIGINS, libera tudo
    if (allowedOrigins.length === 0 && NODE_ENV !== 'production') return callback(null, true);
    if (allowedOrigins.includes('*')) return callback(null, true);
    // Em produÃ§Ã£o, aceita apenas origens explicitamente permitidas
    if (allowedOrigins.includes(normalized)) return callback(null, true);
    // Nao dispara erro 500 por CORS; apenas nega headers CORS para a origem.
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-User-Id',
    'X-User-Role',
    'X-User-Email',
    'X-User-Name',
    'X-Clerk-User-Id'
  ]
}));

// Parser JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Contexto de usuario para isolamento de dados
app.use((req, res, next) => {
  storage.runWithRequestContext(req, next);
});

// Exige contexto de usuario para operacoes de dados (Clerk)
app.use((req, res, next) => {
  if (!REQUIRE_USER_CONTEXT) return next();
  if (req.method === 'OPTIONS') return next();
  if (!req.path.startsWith('/api')) return next();
  if (req.path === '/api' || req.path === '/api/health' || req.path === '/api/wake-up') return next();

  const userId = (req.headers['x-user-id'] || req.headers['x-clerk-user-id'] || '').toString().trim().toLowerCase();
  if (!userId || userId === 'public') {
    return res.status(401).json({
      success: false,
      error: 'Usuario nao autenticado. Faca login no Clerk para acessar seus dados.'
    });
  }

  return next();
});


// Log de requisiÃ§Ãµes
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const userCtx = storage.getCurrentUserContext();
  console.log(`[${timestamp}] [user:${userCtx.userId}] ${req.method} ${req.url}`);
  next();
});

// =============================================
// IMPORTAÃ‡ÃƒO DE ROTAS
// =============================================

const clientesRoutes = require('./routes/clientes');
const renovacoesRoutes = require('./routes/renovacoes');
const servidoresRoutes = require('./routes/servidores');
const revendedoresRoutes = require('./routes/revendedores');
const mensagensRoutes = require('./routes/mensagens');
const precificacaoRoutes = require('./routes/precificacao');
const recebiveisRoutes = require('./routes/recebiveis');
const configuracoesRoutes = require('./routes/configuracoes');
const recargasCelularRoutes = require('./routes/recargas-celular');
const marketplaceRoutes = require('./routes/marketplace');
const authRoutes = require('./routes/auth');

// =============================================
// ROTAS
// =============================================

// Rota de health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    github_configured: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO)
  });
});

// Rota raiz (informativa)
app.get('/', (req, res) => {
  res.json({
    name: 'Preco Certo Backend',
    status: 'online',
    message: 'API ativa. Use /api para listar endpoints e /api/health para status.',
    docs: {
      api: '/api',
      health: '/api/health'
    }
  });
});

// Health check simples para plataformas que validam /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

// Rota wake-up (para manter o servidor ativo)
app.get('/api/wake-up', (req, res) => {
  res.json({
    message: 'Server is awake!',
    timestamp: new Date().toISOString()
  });
});

// Rotas da API
app.use(authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/renovacoes', renovacoesRoutes);
app.use('/api/servidores', servidoresRoutes);
app.use('/api/revendedores', revendedoresRoutes);
app.use('/api/mensagens', mensagensRoutes);
app.use('/api/precificacao', precificacaoRoutes);
app.use('/api/recebiveis', recebiveisRoutes);
app.use('/api/configuracoes', configuracoesRoutes);
app.use('/api/recargas-celular', recargasCelularRoutes);
app.use('/api/marketplace', marketplaceRoutes);

// Rota de info da API
app.get('/api', (req, res) => {
  res.json({
    name: 'Preço Certo Backend',
    version: '1.0.0',
    description: 'Backend do sistema Preço Certo - GitHub Storage',
    github: {
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      configured: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO)
    },
    endpoints: {
      health: '/api/health',
      wakeUp: '/api/wake-up',
      clientes: {
        list: 'GET /api/clientes',
        get: 'GET /api/clientes/:id',
        create: 'POST /api/clientes',
        update: 'PATCH /api/clientes/:id',
        delete: 'DELETE /api/clientes/:id',
        migrarServidor: 'POST /api/clientes/:id/migrar-servidor',
        mudarPlano: 'POST /api/clientes/:id/mudar-plano',
        filterStatus: 'GET /api/clientes/filtro/status/:status',
        filterVencimento: 'GET /api/clientes/filtro/vencimento/:dias',
        clearCache: 'POST /api/clientes/clear-cache'
      },
      renovacoes: {
        list: 'GET /api/renovacoes',
        get: 'GET /api/renovacoes/:id',
        byCliente: 'GET /api/renovacoes/cliente/:clienteId',
        create: 'POST /api/renovacoes',
        executar: 'POST /api/renovacoes/executar',
        estatisticas: 'GET /api/renovacoes/estatisticas/resumo',
        historicoMeses: 'GET /api/renovacoes/historico/meses',
        historicoMes: 'GET /api/renovacoes/historico/:anoMes',
        historicoExcluir: 'DELETE /api/renovacoes/historico/:anoMes'
      },
      servidores: {
        list: 'GET /api/servidores',
        get: 'GET /api/servidores/:id',
        create: 'POST /api/servidores',
        update: 'PATCH /api/servidores/:id',
        delete: 'DELETE /api/servidores/:id'
      },
      revendedores: {
        list: 'GET /api/revendedores',
        get: 'GET /api/revendedores/:id',
        create: 'POST /api/revendedores',
        update: 'PATCH /api/revendedores/:id',
        delete: 'DELETE /api/revendedores/:id'
      },
      mensagens: {
        list: 'GET /api/mensagens',
        updateAll: 'PUT /api/mensagens',
        update: 'PATCH /api/mensagens/:id'
      },
      precificacao: {
        list: 'GET /api/precificacao',
        get: 'GET /api/precificacao/:id',
        create: 'POST /api/precificacao',
        update: 'PATCH /api/precificacao/:id',
        delete: 'DELETE /api/precificacao/:id'
      },
      recebiveis: {
        list: 'GET /api/recebiveis',
        get: 'GET /api/recebiveis/:id',
        create: 'POST /api/recebiveis',
        update: 'PATCH /api/recebiveis/:id',
        delete: 'DELETE /api/recebiveis/:id'
      },
      recargas_celular: {
        list: 'GET /api/recargas-celular',
        create: 'POST /api/recargas-celular',
        config_get: 'GET /api/recargas-celular/config',
        config_update_by_dev: 'PUT /api/recargas-celular/config',
        pix_config_get: 'GET /api/recargas-celular/pix-config',
        pix_config_update_by_dev: 'PUT /api/recargas-celular/pix-config',
        update_by_dev: 'PATCH /api/recargas-celular/:id/admin'
      },
      marketplace: {
        categories_list: 'GET /api/marketplace/categories',
        categories_create_by_dev: 'POST /api/marketplace/categories',
        categories_delete_by_dev: 'DELETE /api/marketplace/categories/:categoria',
        products_list: 'GET /api/marketplace/products',
        products_create_by_dev: 'POST /api/marketplace/products',
        products_update_by_dev: 'PATCH /api/marketplace/products/:id',
        products_delete_by_dev: 'DELETE /api/marketplace/products/:id',
        orders_list: 'GET /api/marketplace/orders',
        orders_create: 'POST /api/marketplace/orders',
        orders_update_by_dev: 'PATCH /api/marketplace/orders/:id/admin'
      },
      configuracoes: {
        get: 'GET /api/configuracoes',
        update: 'PUT /api/configuracoes'
      }
    }
  });
});

// =============================================
// TRATAMENTO DE ERROS
// =============================================

// Middleware de erro 404
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Endpoint nÃ£o encontrado',
    path: req.url,
    method: req.method
  });
});

// Middleware de erro global
app.use((err, req, res, next) => {
  console.error('âŒ Erro:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor',
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

// =============================================
// INICIALIZAÃ‡ÃƒO DO SERVIDOR
// =============================================

async function ensureRepoFiles() {
  if (!storage.isConfigured()) {
    console.log('GitHub Storage nÃ£o configurado â€” pulando verificaÃ§Ã£o de arquivos no repositÃ³rio.');
    return;
  }

  try {
    await storage.ensureBackupRoot();
    console.log('Pasta de backup inicializada.');
  } catch (err) {
    console.error('Falha ao inicializar pasta backup:', err.message || err);
  }

  const files = [
    { path: 'data/clientes.json', content: [] },
    { path: 'data/renovacoes.json', content: [] },
    { path: 'data/servidores.json', content: [] },
    { path: 'data/revendedores.json', content: [] },
    { path: 'data/mensagens_cobranca.json', content: [] },
    { path: 'Atelie/precificacao.json', content: [] },
    { path: 'Atelie/recebiveis.json', content: [] },
    { path: 'Atelie/recargas_celular.json', content: [] },
    {
      path: 'Atelie/recargas_celular_config.json',
      content: {
        operadoras: {
          Tim: { ativa: true, planos: [{ credito: 10, paga: 10 }, { credito: 15, paga: 15 }, { credito: 20, paga: 20 }, { credito: 30, paga: 30 }, { credito: 50, paga: 50 }] },
          Vivo: { ativa: true, planos: [{ credito: 10, paga: 10 }, { credito: 15, paga: 15 }, { credito: 20, paga: 20 }, { credito: 30, paga: 30 }, { credito: 50, paga: 50 }] },
          Claro: { ativa: true, planos: [{ credito: 10, paga: 10 }, { credito: 15, paga: 15 }, { credito: 20, paga: 20 }, { credito: 30, paga: 30 }, { credito: 50, paga: 50 }] }
        }
      }
    },
    {
      path: 'Atelie/recargas_pix_config.json',
      content: {
        pix_key: '82999158412',
        pix_key_type: 'telefone',
        pix_merchant_name: 'PRECO CERTO',
        pix_city: 'ARAPIRACA'
      }
    },
    { path: 'Atelie/marketplace_products.json', content: [] },
    { path: 'Atelie/marketplace_orders.json', content: [] },
    { path: 'Atelie/marketplace_categories.json', content: ['Roupas', 'Acessorios', 'Servicos'] },
    { path: 'Atelie/configuracoes_usuario.json', content: { tecidos: {}, forros: {}, aviamentos: {} } },
    { path: 'Atelie/images/index.json', content: [] }
  ];

  for (const f of files) {
    try {
      const sha = await storage.getFileSha(f.path);
      if (!sha) {
        console.log(`Arquivo ${f.path} nÃ£o encontrado no repositÃ³rio â€” criando com conteÃºdo inicial.`);
        const res = await storage.writeFile(f.path, f.content, `Criar ${f.path} (inicial)`);
        if (res && res.success) {
          console.log(`âœ… Arquivo criado: ${f.path}`);
        } else {
          console.warn(`âŒ Falha ao criar ${f.path}:`, res && res.error ? res.error : 'erro desconhecido');
        }
      } else {
        console.log(`Arquivo existe: ${f.path}`);
      }
    } catch (err) {
      console.error(`Erro verificando/criando ${f.path}:`, err.message || err);
    }
  }
}

(async () => {
  await ensureRepoFiles();

  app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('ðŸŽ¬ Preço Certo Backend');
  console.log('='.repeat(60));
  console.log(`ðŸš€ Servidor iniciado!`);
  console.log(`ðŸ“¡ Porta: ${PORT}`);
  console.log(`ðŸŒ Ambiente: ${NODE_ENV}`);
  console.log(`ðŸ” CORS: ${allowedOrigins.length ? allowedOrigins.join(', ') : (NODE_ENV === 'production' ? 'nenhuma origem liberada (defina CORS_ALLOWED_ORIGINS)' : 'modo aberto para desenvolvimento')}`);
  console.log(`â° Iniciado em: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log('');
  console.log('ðŸ“ GitHub Storage:');

  console.log(`   Owner: ${process.env.GITHUB_OWNER || 'nÃ£o configurado'}`);
  console.log(`   Repo: ${process.env.GITHUB_REPO || 'nÃ£o configurado'}`);
  console.log(`   Branch: ${process.env.GITHUB_BRANCH || 'main'}`);
  console.log(`   Status: ${process.env.GITHUB_TOKEN ? 'âœ… Configurado' : 'âŒ Token nÃ£o configurado'}`);
  console.log('');
  console.log('ðŸ“¡ Endpoints disponÃ­veis:');
  console.log('   Clientes:');
  console.log('     GET    /api/clientes');
  console.log('     GET    /api/clientes/:id');
  console.log('     POST   /api/clientes');
  console.log('     PATCH  /api/clientes/:id');
  console.log('     DELETE /api/clientes/:id');
  console.log('');
  console.log('   RenovaÃ§Ãµes:');
  console.log('     GET    /api/renovacoes');
  console.log('     POST   /api/renovacoes');
  console.log('     POST   /api/renovacoes/executar');
  console.log('');
  console.log('   Servidores:');
  console.log('     GET    /api/servidores');
  console.log('     POST   /api/servidores');
  console.log('     PATCH  /api/servidores/:id');
  console.log('     DELETE /api/servidores/:id');
  console.log('');
  console.log('   Revendedores:');
  console.log('     GET    /api/revendedores');
  console.log('     POST   /api/revendedores');
  console.log('     PATCH  /api/revendedores/:id');
  console.log('     DELETE /api/revendedores/:id');
  console.log('');
  console.log('   Outros:');
  console.log('     GET    /api/health');
  console.log('     GET    /api/wake-up');
  console.log('');
  });
})();

// Tratamento de encerramento gracioso
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido. Encerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT recebido. Encerrando servidor...');
  process.exit(0);
});


