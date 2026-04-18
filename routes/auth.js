const express = require('express');
const crypto = require('crypto');
const { storage } = require('../githubStorage');

const router = express.Router();

const USERS_DIR = 'auth/users';
const EMAIL_INDEX_PATH = 'auth/index_by_email.json';
const PHONE_INDEX_PATH = 'auth/index_by_phone.json';
const GROUP_PAGES_PATH = 'auth/group_pages.json';

const DEFAULT_GROUP_PAGES = {
  usuario: ['index.html', 'precificacao.html', 'produtos-atelie.html', 'configuracoes.html'],
  administrador: [
    'index.html',
    'dashboard.html',
    'renovacoes.html',
    'historico-renovacoes.html',
    'servidores.html',
    'revendedores.html',
    'mensagens.html',
    'dindin.html',
    'recebiveis.html',
    'precificacao.html',
    'produtos-atelie.html',
    'configuracoes.html'
  ],
  desenvolvedor: ['*']
};

const AUTH_SECRET = String(process.env.AUTH_SECRET || 'preco-certo-node-auth-secret');
const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 2592000);

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'desenvolvedor' || raw === 'developer') return 'desenvolvedor';
  if (raw === 'administrador' || raw === 'admin') return 'administrador';
  return 'usuario';
}

function normalizeSex(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw !== 'masculino' && raw !== 'feminino') {
    throw httpError(400, 'Sexo deve ser masculino ou feminino');
  }
  return raw;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const iterations = 210000;
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return {
    salt: salt.toString('hex'),
    iterations,
    hash
  };
}

function verifyPassword(password, passwordData) {
  try {
    const salt = String(passwordData && passwordData.salt ? passwordData.salt : '');
    const expected = String(passwordData && passwordData.hash ? passwordData.hash : '');
    const iterations = Number(passwordData && passwordData.iterations ? passwordData.iterations : 210000);
    if (!salt || !expected) return false;
    const got = crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch (_) {
    return false;
  }
}

function b64urlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(text) {
  let value = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = value.length % 4;
  if (pad) value += '='.repeat(4 - pad);
  return Buffer.from(value, 'base64');
}

function createToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64urlEncode(Buffer.from(JSON.stringify(header)));
  const p = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const signed = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(signed).digest();
  return `${signed}.${b64urlEncode(sig)}`;
}

function decodeToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw httpError(401, 'Token invalido');
  const [h, p, s] = parts;
  const signed = `${h}.${p}`;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(signed).digest();
  const got = b64urlDecode(s);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
    throw httpError(401, 'Token invalido');
  }
  const payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
    throw httpError(401, 'Token expirado');
  }
  return payload;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sanitizeUserOutput(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    image_url: user.image_url,
    address: user.address,
    cep: user.cep,
    street: user.street,
    number: user.number,
    city: user.city,
    state: user.state,
    sex: user.sex,
    role: user.role,
    created_at: user.created_at,
    updated_at: user.updated_at,
    active: user.active !== false
  };
}

async function readJson(path) {
  return storage.readFile(path, { skipNamespace: true, skipBackup: true });
}

async function writeJson(path, content, message) {
  const result = await storage.writeFile(path, content, message, { skipNamespace: true, skipBackup: true });
  if (!result || !result.success) {
    throw httpError(500, result && result.error ? result.error : 'Falha ao salvar dados');
  }
}

async function ensureJsonFile(path, defaultValue) {
  const data = await readJson(path);
  if (data !== null && data !== undefined) return data;
  await writeJson(path, defaultValue, `Inicializar ${path}`);
  return JSON.parse(JSON.stringify(defaultValue));
}

async function loadIndexes() {
  const emailIdx = await ensureJsonFile(EMAIL_INDEX_PATH, {});
  const phoneIdx = await ensureJsonFile(PHONE_INDEX_PATH, {});
  return {
    emailIdx: (emailIdx && typeof emailIdx === 'object') ? emailIdx : {},
    phoneIdx: (phoneIdx && typeof phoneIdx === 'object') ? phoneIdx : {}
  };
}

async function loadGroupPages() {
  const data = await ensureJsonFile(GROUP_PAGES_PATH, DEFAULT_GROUP_PAGES);
  const merged = { ...DEFAULT_GROUP_PAGES };
  if (data && typeof data === 'object') {
    for (const role of ['usuario', 'administrador', 'desenvolvedor']) {
      if (Array.isArray(data[role])) merged[role] = data[role].map((x) => String(x));
    }
  }
  return merged;
}

function getUserPath(userId) {
  return `${USERS_DIR}/${userId}.json`;
}

async function readUser(userId) {
  const data = await readJson(getUserPath(userId));
  if (!data || typeof data !== 'object') return null;
  return data;
}

async function writeUser(user, message) {
  await writeJson(getUserPath(user.id), user, message || `Atualizar usuario ${user.id}`);
}

async function getAllowedPagesForUser(user) {
  const role = normalizeRole(user.role);
  const groupPages = await loadGroupPages();
  const pages = Array.isArray(groupPages[role]) ? [...groupPages[role]] : [...DEFAULT_GROUP_PAGES.usuario];
  if (role !== 'desenvolvedor' && !pages.includes('perfil-usuario.html')) pages.push('perfil-usuario.html');
  return pages;
}

function parseBearerToken(headerValue) {
  const raw = String(headerValue || '');
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  return raw.slice(7).trim() || null;
}

async function getCurrentUser(req) {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) throw httpError(401, 'Autenticacao obrigatoria');
  const payload = decodeToken(token);
  const userId = String(payload.sub || '').trim();
  if (!userId) throw httpError(401, 'Token invalido');
  const user = await readUser(userId);
  if (!user || user.active === false) throw httpError(401, 'Usuario invalido');
  return user;
}

function ensureDeveloper(user) {
  if (normalizeRole(user.role) !== 'desenvolvedor') {
    throw httpError(403, 'Apenas desenvolvedor pode executar essa acao');
  }
}

function normalizeAndValidatePhone(raw) {
  let phone = normalizePhone(raw);
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (!phone.startsWith('55') || (phone.length !== 12 && phone.length !== 13)) {
    throw httpError(400, 'Telefone invalido. Use formato brasileiro com DDD');
  }
  return phone;
}

function applyUpdatePayloadToUser(targetUser, payload, options = {}) {
  const allowActive = !!options.allowActive;
  if (payload.nome !== undefined) {
    const nome = String(payload.nome || '').trim();
    if (nome.length < 2) throw httpError(400, 'Nome invalido');
    targetUser.name = nome;
  }
  if (payload.endereco !== undefined) targetUser.address = String(payload.endereco || '').trim();
  if (payload.rua !== undefined) targetUser.street = String(payload.rua || '').trim();
  if (payload.numero !== undefined) targetUser.number = String(payload.numero || '').trim();
  if (payload.cidade !== undefined) targetUser.city = String(payload.cidade || '').trim();
  if (payload.image_url !== undefined) targetUser.image_url = String(payload.image_url || '').trim();
  if (payload.sexo !== undefined) targetUser.sex = normalizeSex(payload.sexo);
  if (payload.cep !== undefined) {
    const cep = normalizePhone(payload.cep);
    if (cep.length !== 8) throw httpError(400, 'CEP invalido');
    targetUser.cep = cep;
  }
  if (payload.estado !== undefined) {
    const uf = String(payload.estado || '').trim().toUpperCase();
    if (uf.length !== 2) throw httpError(400, 'Estado invalido. Use UF com 2 letras');
    targetUser.state = uf;
  }
  if (allowActive && payload.active !== undefined) targetUser.active = !!payload.active;
}

async function withErrors(res, handler) {
  try {
    await handler();
  } catch (err) {
    const status = Number(err && err.status ? err.status : 500);
    res.status(status).json({
      success: false,
      error: err && err.message ? err.message : 'Erro interno'
    });
  }
}

router.get('/auth/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: nowIso(),
    github_configured: storage.isConfigured()
  });
});

router.post('/auth/register', async (req, res) => withErrors(res, async () => {
  if (!storage.isConfigured()) throw httpError(500, 'GitHub Storage nao configurado');

  const payload = req.body || {};
  const email = normalizeEmail(payload.email);
  const password = String(payload.senha || '');
  const phone = normalizeAndValidatePhone(payload.telefone);
  const name = String(payload.nome || '').trim();
  const address = String(payload.endereco || '').trim();
  const sex = normalizeSex(payload.sexo);
  const cep = normalizePhone(payload.cep || '');
  const uf = String(payload.estado || '').trim().toUpperCase();

  if (name.length < 2) throw httpError(400, 'Nome invalido');
  if (!isValidEmail(email)) throw httpError(400, 'E-mail invalido');
  if (password.length < 6) throw httpError(400, 'Senha deve ter no minimo 6 caracteres');
  if (address.length < 3) throw httpError(400, 'Endereco invalido');
  if (cep.length !== 8) throw httpError(400, 'CEP invalido');
  if (uf.length !== 2) throw httpError(400, 'Estado invalido. Use UF com 2 letras');

  const { emailIdx, phoneIdx } = await loadIndexes();
  if (emailIdx[email]) throw httpError(409, 'E-mail ja cadastrado');
  if (phoneIdx[phone]) throw httpError(409, 'Telefone ja cadastrado');

  const userId = crypto.randomUUID().replace(/-/g, '').slice(0, 18);
  const ts = nowIso();
  const user = {
    id: userId,
    name,
    email,
    phone,
    image_url: '',
    address,
    cep,
    street: String(payload.rua || '').trim(),
    number: String(payload.numero || '').trim(),
    city: String(payload.cidade || '').trim(),
    state: uf,
    sex,
    role: 'usuario',
    password: hashPassword(password),
    created_at: ts,
    updated_at: ts,
    active: true
  };

  await writeUser(user, `Criar usuario ${userId}`);
  emailIdx[email] = userId;
  phoneIdx[phone] = userId;
  await writeJson(EMAIL_INDEX_PATH, emailIdx, `Atualizar indice de email (${email})`);
  await writeJson(PHONE_INDEX_PATH, phoneIdx, `Atualizar indice de telefone (${phone})`);

  res.json({
    success: true,
    data: {
      user: sanitizeUserOutput(user),
      allowed_pages: await getAllowedPagesForUser(user)
    }
  });
}));

router.post('/auth/login', async (req, res) => withErrors(res, async () => {
  if (!storage.isConfigured()) throw httpError(500, 'GitHub Storage nao configurado');
  const payload = req.body || {};
  const identifier = String(payload.identifier || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!identifier) throw httpError(400, 'Informe e-mail ou telefone');

  const { emailIdx, phoneIdx } = await loadIndexes();
  let userId = emailIdx[normalizeEmail(identifier)];
  if (!userId) {
    const p = normalizePhone(identifier);
    userId = phoneIdx[p];
  }
  if (!userId) throw httpError(401, 'Usuario ou senha invalidos');

  const user = await readUser(userId);
  if (!user || user.active === false) throw httpError(401, 'Usuario ou senha invalidos');
  if (!verifyPassword(password, user.password || {})) throw httpError(401, 'Usuario ou senha invalidos');

  const nowTs = Math.floor(Date.now() / 1000);
  const token = createToken({
    sub: user.id,
    role: normalizeRole(user.role),
    email: user.email,
    iat: nowTs,
    exp: nowTs + TOKEN_TTL_SECONDS
  });

  res.json({
    success: true,
    data: {
      token,
      expires_in: TOKEN_TTL_SECONDS,
      user: sanitizeUserOutput(user),
      allowed_pages: await getAllowedPagesForUser(user)
    }
  });
}));

router.get('/auth/me', async (req, res) => withErrors(res, async () => {
  const user = await getCurrentUser(req);
  res.json({
    success: true,
    data: {
      user: sanitizeUserOutput(user),
      allowed_pages: await getAllowedPagesForUser(user)
    }
  });
}));

router.patch('/auth/me', async (req, res) => withErrors(res, async () => {
  const currentUser = await getCurrentUser(req);
  const userId = String(currentUser.id || '').trim();
  if (!userId) throw httpError(401, 'Usuario invalido');
  const targetUser = await readUser(userId);
  if (!targetUser) throw httpError(404, 'Usuario nao encontrado');

  const payload = req.body || {};
  const { emailIdx, phoneIdx } = await loadIndexes();
  const oldEmail = normalizeEmail(targetUser.email || '');
  const oldPhone = normalizePhone(targetUser.phone || '');

  if (payload.email !== undefined) {
    const newEmail = normalizeEmail(payload.email);
    if (!isValidEmail(newEmail)) throw httpError(400, 'E-mail invalido');
    if (emailIdx[newEmail] && emailIdx[newEmail] !== userId) throw httpError(409, 'E-mail ja cadastrado');
    if (oldEmail && oldEmail !== newEmail) delete emailIdx[oldEmail];
    emailIdx[newEmail] = userId;
    targetUser.email = newEmail;
  }

  if (payload.telefone !== undefined) {
    const newPhone = normalizeAndValidatePhone(payload.telefone);
    if (phoneIdx[newPhone] && phoneIdx[newPhone] !== userId) throw httpError(409, 'Telefone ja cadastrado');
    if (oldPhone && oldPhone !== newPhone) delete phoneIdx[oldPhone];
    phoneIdx[newPhone] = userId;
    targetUser.phone = newPhone;
  }

  applyUpdatePayloadToUser(targetUser, payload, { allowActive: false });

  if (payload.senha_nova !== undefined || payload.senha_atual !== undefined) {
    const senhaAtual = String(payload.senha_atual || '');
    const senhaNova = String(payload.senha_nova || '');
    if (!senhaAtual || !senhaNova) throw httpError(400, 'Informe senha_atual e senha_nova');
    if (senhaNova.length < 6) throw httpError(400, 'Nova senha deve ter no minimo 6 caracteres');
    if (!verifyPassword(senhaAtual, targetUser.password || {})) throw httpError(401, 'Senha atual invalida');
    targetUser.password = hashPassword(senhaNova);
  }

  targetUser.updated_at = nowIso();
  await writeUser(targetUser, `Atualizar perfil do usuario ${userId}`);
  await writeJson(EMAIL_INDEX_PATH, emailIdx, 'Atualizar indice de email');
  await writeJson(PHONE_INDEX_PATH, phoneIdx, 'Atualizar indice de telefone');

  res.json({
    success: true,
    data: {
      user: sanitizeUserOutput(targetUser),
      allowed_pages: await getAllowedPagesForUser(targetUser)
    }
  });
}));

router.get('/auth/users', async (req, res) => withErrors(res, async () => {
  const current = await getCurrentUser(req);
  ensureDeveloper(current);
  const { emailIdx } = await loadIndexes();
  const uniqueIds = [...new Set(Object.values(emailIdx || {}))];
  const users = [];
  for (const userId of uniqueIds) {
    const u = await readUser(userId);
    if (u) users.push(sanitizeUserOutput(u));
  }
  users.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json({ success: true, data: users });
}));

router.get('/auth/permissions', async (req, res) => withErrors(res, async () => {
  const current = await getCurrentUser(req);
  ensureDeveloper(current);
  res.json({ success: true, data: await loadGroupPages() });
}));

router.put('/auth/permissions/:role', async (req, res) => withErrors(res, async () => {
  const current = await getCurrentUser(req);
  ensureDeveloper(current);
  const role = normalizeRole(req.params.role);
  const pages = (req.body && Array.isArray(req.body.pages)) ? req.body.pages.map((x) => String(x).trim()).filter(Boolean) : null;
  if (!pages || pages.length === 0) throw httpError(400, 'Informe pages como lista de strings');
  const cfg = await loadGroupPages();
  cfg[role] = pages;
  await writeJson(GROUP_PAGES_PATH, cfg, `Atualizar permissoes do grupo ${role}`);
  res.json({ success: true, data: cfg });
}));

router.post('/auth/users/:userId/role', async (req, res) => withErrors(res, async () => {
  const current = await getCurrentUser(req);
  ensureDeveloper(current);
  const userId = String(req.params.userId || '').trim();
  const role = normalizeRole(req.query.role || (req.body && req.body.role));
  const target = await readUser(userId);
  if (!target) throw httpError(404, 'Usuario nao encontrado');
  target.role = role;
  target.updated_at = nowIso();
  await writeUser(target, `Atualizar role do usuario ${userId}`);
  res.json({
    success: true,
    data: {
      user: sanitizeUserOutput(target),
      allowed_pages: await getAllowedPagesForUser(target)
    }
  });
}));

router.patch('/auth/users/:userId', async (req, res) => withErrors(res, async () => {
  const current = await getCurrentUser(req);
  ensureDeveloper(current);
  const userId = String(req.params.userId || '').trim();
  const target = await readUser(userId);
  if (!target) throw httpError(404, 'Usuario nao encontrado');
  const payload = req.body || {};
  const { emailIdx, phoneIdx } = await loadIndexes();

  const oldEmail = normalizeEmail(target.email || '');
  const oldPhone = normalizePhone(target.phone || '');

  if (payload.email !== undefined) {
    const newEmail = normalizeEmail(payload.email);
    if (!isValidEmail(newEmail)) throw httpError(400, 'E-mail invalido');
    if (emailIdx[newEmail] && emailIdx[newEmail] !== userId) throw httpError(409, 'E-mail ja cadastrado');
    if (oldEmail && oldEmail !== newEmail) delete emailIdx[oldEmail];
    emailIdx[newEmail] = userId;
    target.email = newEmail;
  }
  if (payload.telefone !== undefined) {
    const newPhone = normalizeAndValidatePhone(payload.telefone);
    if (phoneIdx[newPhone] && phoneIdx[newPhone] !== userId) throw httpError(409, 'Telefone ja cadastrado');
    if (oldPhone && oldPhone !== newPhone) delete phoneIdx[oldPhone];
    phoneIdx[newPhone] = userId;
    target.phone = newPhone;
  }

  applyUpdatePayloadToUser(target, payload, { allowActive: true });
  target.updated_at = nowIso();
  await writeUser(target, `Atualizar dados do usuario ${userId}`);
  await writeJson(EMAIL_INDEX_PATH, emailIdx, 'Atualizar indice de email');
  await writeJson(PHONE_INDEX_PATH, phoneIdx, 'Atualizar indice de telefone');

  res.json({
    success: true,
    data: {
      user: sanitizeUserOutput(target),
      allowed_pages: await getAllowedPagesForUser(target)
    }
  });
}));

module.exports = router;
