const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { storage } = require('../githubStorage');

const router = express.Router();

const USERS_DIR = 'auth/users';
const EMAIL_INDEX_PATH = 'auth/index_by_email.json';
const PHONE_INDEX_PATH = 'auth/index_by_phone.json';
const GROUP_PAGES_PATH = 'auth/group_pages.json';

const DEFAULT_GROUP_PAGES = {
  usuario: ['marketplace.html', 'index.html', 'precificacao.html', 'produtos-atelie.html', 'configuracoes.html', 'recarga-celular.html', 'historico-compras.html'],
  administrador: [
    'marketplace.html',
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
    'configuracoes.html',
    'recarga-celular.html',
    'historico-compras.html'
  ],
  desenvolvedor: ['*']
};

const AUTH_SECRET = String(process.env.AUTH_SECRET || 'preco-certo-node-auth-secret');
const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 2592000);
const ACTIVE_SESSION_IDLE_SECONDS = Number(process.env.AUTH_ACTIVE_SESSION_IDLE_SECONDS || 900);
const PASSWORD_RESET_TTL_SECONDS = Number(process.env.AUTH_PASSWORD_RESET_TTL_SECONDS || 900);
const PASSWORD_RESET_CODE_LENGTH = Math.max(4, Math.min(8, Number(process.env.AUTH_PASSWORD_RESET_CODE_LENGTH || 6)));
const PASSWORD_RESET_EXPOSE_CODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.AUTH_PASSWORD_RESET_EXPOSE_CODE || 'false').trim().toLowerCase());
const AUTH_PASSWORD_RESET_PAGE_URL = String(process.env.AUTH_PASSWORD_RESET_PAGE_URL || 'https://jeffibr.github.io/Service/reset-password.html').trim();
const BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim();
const BREVO_SENDER_EMAIL = String(process.env.BREVO_SENDER_EMAIL || '').trim();
const BREVO_SENDER_NAME = String(process.env.BREVO_SENDER_NAME || 'Preco Certo').trim();
const BREVO_API_BASE = String(process.env.BREVO_API_BASE || 'https://api.brevo.com').trim().replace(/\/+$/, '');

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function isBrevoConfigured() {
  return !!(BREVO_API_KEY && BREVO_SENDER_EMAIL && BREVO_API_BASE);
}

function generatePasswordResetCode() {
  let code = '';
  const chars = '0123456789';
  for (let i = 0; i < PASSWORD_RESET_CODE_LENGTH; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function hashPasswordResetCode(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function buildPasswordResetLink(email, code) {
  const base = AUTH_PASSWORD_RESET_PAGE_URL || 'https://jeffibr.github.io/Service/reset-password.html';
  const qs = new URLSearchParams({
    mode: 'signin',
    recover: '1',
    recover_email: String(email || ''),
    recover_code: String(code || '')
  }).toString();
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

async function sendPasswordResetEmail(toEmail, toName, code, resetLink) {
  if (!isBrevoConfigured()) throw httpError(500, 'Brevo não configurado para envio de recuperação.');

  const ttlMinutes = Math.max(1, Math.floor(PASSWORD_RESET_TTL_SECONDS / 60));
  const safeName = String(toName || 'Usuario').trim() || 'Usuario';
  const htmlContent = `
    <html>
      <body style="font-family:Arial,sans-serif;background:#0b0c10;color:#f4f4f5;padding:20px;">
        <div style="max-width:520px;margin:0 auto;background:#151821;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px;">
          <h2 style="margin:0 0 12px;">Recuperacao de senha</h2>
          <p style="margin:0 0 10px;">Ola, ${safeName}.</p>
          <p style="margin:0 0 10px;">Use o codigo abaixo para redefinir sua senha:</p>
          <div style="font-size:28px;font-weight:800;letter-spacing:4px;background:#0f1118;border:1px dashed #fbbf24;border-radius:10px;padding:14px;text-align:center;color:#fbbf24;">
            ${String(code || '')}
          </div>
          <p style="margin:14px 0 8px;">Ou clique no botao abaixo para abrir a tela de redefinicao:</p>
          <p style="margin:0 0 8px;">
            <a href="${String(resetLink || '')}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#fbbf24;color:#111;text-decoration:none;font-weight:800;">Redefinir senha</a>
          </p>
          <p style="margin:6px 0 0;color:#a1a1aa;font-size:12px;word-break:break-all;">Link: ${String(resetLink || '')}</p>
          <p style="margin:14px 0 0;color:#a1a1aa;">Este codigo expira em aproximadamente ${ttlMinutes} minuto(s).</p>
          <p style="margin:8px 0 0;color:#a1a1aa;">Se voce nao solicitou esta alteracao, ignore este e-mail.</p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch(`${BREVO_API_BASE}/v3/smtp/email`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email: toEmail, name: safeName }],
      subject: 'Codigo de recuperacao de senha - Preco Certo',
      htmlContent
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw httpError(500, `Falha ao enviar e-mail Brevo: ${response.status} ${body}`);
  }
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
  if (parts.length !== 3) throw httpError(401, 'Token inv?lido');
  const [h, p, s] = parts;
  const signed = `${h}.${p}`;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(signed).digest();
  const got = b64urlDecode(s);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
    throw httpError(401, 'Token inv?lido');
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

function parseDateMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function isSessionOnline(session) {
  if (!session || typeof session !== 'object') return false;
  const lastSeenMs = parseDateMs(session.last_seen || session.updated_at || session.created_at);
  if (!lastSeenMs) return false;
  const idleMs = Math.max(15, ACTIVE_SESSION_IDLE_SECONDS) * 1000;
  return (Date.now() - lastSeenMs) <= idleMs;
}

function createSessionMeta() {
  const ts = nowIso();
  return {
    id: crypto.randomUUID().replace(/-/g, ''),
    created_at: ts,
    last_seen: ts
  };
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
  if (role !== 'desenvolvedor') {
    const marketplaceIdx = pages.indexOf('marketplace.html');
    if (marketplaceIdx === -1) pages.unshift('marketplace.html');
    else if (marketplaceIdx > 0) {
      pages.splice(marketplaceIdx, 1);
      pages.unshift('marketplace.html');
    }
    if (!pages.includes('perfil-usuario.html')) pages.push('perfil-usuario.html');
  }
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
  if (!userId) throw httpError(401, 'Token inv?lido');
  const sessionId = String(payload.sid || '').trim();
  if (!sessionId) throw httpError(401, 'Sessao invalida. Faça login novamente');
  const user = await readUser(userId);
  if (!user || user.active === false) throw httpError(401, 'Usuário inválido');
  if (!user.active_session || String(user.active_session.id || '') !== sessionId) {
    throw httpError(401, 'Sessao encerrada. Faça login novamente');
  }
  if (!isSessionOnline(user.active_session)) {
    throw httpError(401, 'Sessao expirada por inatividade. Faça login novamente');
  }
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
    throw httpError(400, 'Telefone inválido. Use formato brasileiro com DDD');
  }
  return phone;
}

function applyUpdatePayloadToUser(targetUser, payload, options = {}) {
  const allowActive = !!options.allowActive;
  if (payload.nome !== undefined) {
    const nome = String(payload.nome || '').trim();
    if (nome.length < 2) throw httpError(400, 'Nome inválido');
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
    if (cep.length !== 8) throw httpError(400, 'CEP inválido');
    targetUser.cep = cep;
  }
  if (payload.estado !== undefined) {
    const uf = String(payload.estado || '').trim().toUpperCase();
    if (uf.length !== 2) throw httpError(400, 'Estado inválido. Use UF com 2 letras');
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
  if (!storage.isConfigured()) throw httpError(500, 'GitHub Storage não configurado');

  const payload = req.body || {};
  const email = normalizeEmail(payload.email);
  const password = String(payload.senha || '');
  const phone = normalizeAndValidatePhone(payload.telefone);
  const name = String(payload.nome || '').trim();
  const address = String(payload.endereco || '').trim();
  const sex = normalizeSex(payload.sexo);
  const cep = normalizePhone(payload.cep || '');
  const uf = String(payload.estado || '').trim().toUpperCase();

  if (name.length < 2) throw httpError(400, 'Nome inválido');
  if (!isValidEmail(email)) throw httpError(400, 'E-mail inválido');
  if (password.length < 6) throw httpError(400, 'Senha deve ter no minimo 6 caracteres');
  if (address.length < 3) throw httpError(400, 'Endereço inválido');
  if (cep.length !== 8) throw httpError(400, 'CEP inválido');
  if (uf.length !== 2) throw httpError(400, 'Estado inválido. Use UF com 2 letras');

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
  if (!storage.isConfigured()) throw httpError(500, 'GitHub Storage não configurado');
  const payload = req.body || {};
  const identifier = String(payload.identifier || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!identifier) throw httpError(400, 'Informe e-mail ou telefone');

  const { emailIdx, phoneIdx } = await loadIndexes();
  let userId = emailIdx[normalizeEmail(identifier)];
  if (!userId) {
    const rawPhone = normalizePhone(identifier);
    const candidates = [];
    if (rawPhone) {
      candidates.push(rawPhone);
      if (rawPhone.length === 10 || rawPhone.length === 11) {
        candidates.push(`55${rawPhone}`);
      }
      if (rawPhone.startsWith('55') && (rawPhone.length === 12 || rawPhone.length === 13)) {
        candidates.push(rawPhone.slice(2));
      }
    }

    const uniqueCandidates = [...new Set(candidates)];
    for (const phoneCandidate of uniqueCandidates) {
      userId = phoneIdx[phoneCandidate];
      if (userId) break;
    }
  }
  if (!userId) throw httpError(401, 'Usuário ou senha inválidos');

  const user = await readUser(userId);
  if (!user || user.active === false) throw httpError(401, 'Usuário ou senha inválidos');
  if (!verifyPassword(password, user.password || {})) throw httpError(401, 'Usuário ou senha inválidos');

  if (isSessionOnline(user.active_session)) {
    throw httpError(409, 'Usuario ja esta online em outro dispositivo');
  }

  const nowTs = Math.floor(Date.now() / 1000);
  const session = createSessionMeta();
  user.active_session = session;
  user.updated_at = nowIso();
  await writeUser(user, `Atualizar sessao ativa do usuario ${user.id}`);

  const token = createToken({
    sub: user.id,
    sid: session.id,
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
      session: {
        id: session.id,
        idle_timeout_seconds: ACTIVE_SESSION_IDLE_SECONDS
      },
      user: sanitizeUserOutput(user),
      allowed_pages: await getAllowedPagesForUser(user)
    }
  });
}));

router.post('/auth/password/forgot', async (req, res) => withErrors(res, async () => {
  if (!storage.isConfigured()) throw httpError(500, 'GitHub Storage não configurado');
  const payload = req.body || {};
  const email = normalizeEmail(payload.email || payload.identifier || '');
  if (!email || !isValidEmail(email)) throw httpError(400, 'Informe um e-mail válido');

  const { emailIdx } = await loadIndexes();
  const userId = emailIdx[email];

  // Não expõe existência do usuário.
  if (!userId) {
    return res.json({
      success: true,
      data: { message: 'Se o e-mail existir, enviaremos um link de recuperação.' }
    });
  }

  const user = await readUser(userId);
  if (!user || user.active === false) {
    return res.json({
      success: true,
      data: { message: 'Se o e-mail existir, enviaremos um link de recuperação.' }
    });
  }

  const code = generatePasswordResetCode();
  const expiresAt = new Date(Date.now() + (Math.max(60, PASSWORD_RESET_TTL_SECONDS) * 1000)).toISOString();
  user.password_reset = {
    code_hash: hashPasswordResetCode(code),
    expires_at: expiresAt,
    requested_at: nowIso()
  };
  user.updated_at = nowIso();
  await writeUser(user, `Solicitar recuperação de senha do usuario ${user.id}`);

  const resetLink = buildPasswordResetLink(email, code);
  await sendPasswordResetEmail(email, user.name || 'Usuario', code, resetLink);

  const response = {
    message: 'Se o e-mail existir, enviaremos um link de recuperação.'
  };
  if (PASSWORD_RESET_EXPOSE_CODE) response.reset_code = code;
  res.json({ success: true, data: response });
}));

router.post('/auth/password/reset', async (req, res) => withErrors(res, async () => {
  if (!storage.isConfigured()) throw httpError(500, 'GitHub Storage não configurado');
  const payload = req.body || {};
  const email = normalizeEmail(payload.email || payload.identifier || '');
  const code = String(payload.code || '').trim();
  const newPassword = String(payload.new_password || payload.newPassword || payload.password || '').trim();

  if (!email || !isValidEmail(email)) throw httpError(400, 'Informe um e-mail válido');
  if (!code) throw httpError(400, 'Informe o código de recuperação');
  if (newPassword.length < 6) throw httpError(400, 'Nova senha deve ter no minimo 6 caracteres');

  const { emailIdx } = await loadIndexes();
  const userId = emailIdx[email];
  if (!userId) throw httpError(400, 'Código inválido ou expirado');

  const user = await readUser(userId);
  if (!user || user.active === false) throw httpError(400, 'Código inválido ou expirado');

  const resetData = (user.password_reset && typeof user.password_reset === 'object') ? user.password_reset : null;
  if (!resetData || !resetData.code_hash || !resetData.expires_at) throw httpError(400, 'Código inválido ou expirado');

  const expiresAtMs = Date.parse(String(resetData.expires_at || ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) throw httpError(400, 'Código inválido ou expirado');

  const expected = String(resetData.code_hash || '');
  const got = hashPasswordResetCode(code);
  if (!expected || expected.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(got, 'utf8'))) {
    throw httpError(400, 'Código inválido ou expirado');
  }

  user.password = hashPassword(newPassword);
  user.password_reset = null;
  user.updated_at = nowIso();
  await writeUser(user, `Redefinir senha do usuario ${user.id}`);

  res.json({
    success: true,
    data: { message: 'Senha redefinida com sucesso.' }
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

router.post('/auth/ping', async (req, res) => withErrors(res, async () => {
  const user = await getCurrentUser(req);
  user.active_session = user.active_session || {};
  user.active_session.last_seen = nowIso();
  user.updated_at = nowIso();
  await writeUser(user, `Atualizar presenca da sessao ${user.id}`);
  res.json({ success: true, data: { online: true, idle_timeout_seconds: ACTIVE_SESSION_IDLE_SECONDS } });
}));

router.post('/auth/logout', async (req, res) => withErrors(res, async () => {
  const user = await getCurrentUser(req);
  user.active_session = null;
  user.updated_at = nowIso();
  await writeUser(user, `Encerrar sessao ativa do usuario ${user.id}`);
  res.json({ success: true });
}));

router.patch('/auth/me', async (req, res) => withErrors(res, async () => {
  const currentUser = await getCurrentUser(req);
  const userId = String(currentUser.id || '').trim();
  if (!userId) throw httpError(401, 'Usuário inválido');
  const targetUser = await readUser(userId);
  if (!targetUser) throw httpError(404, 'Usuário não encontrado');

  const payload = req.body || {};
  const { emailIdx, phoneIdx } = await loadIndexes();
  const oldEmail = normalizeEmail(targetUser.email || '');
  const oldPhone = normalizePhone(targetUser.phone || '');

  if (payload.email !== undefined) {
    const newEmail = normalizeEmail(payload.email);
    if (!isValidEmail(newEmail)) throw httpError(400, 'E-mail inválido');
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

router.get('/auth/users/online', async (req, res) => withErrors(res, async () => {
  const current = await getCurrentUser(req);
  ensureDeveloper(current);

  const { emailIdx } = await loadIndexes();
  const uniqueIds = [...new Set(Object.values(emailIdx || {}))];
  const online = [];

  for (const userId of uniqueIds) {
    const u = await readUser(userId);
    if (!u || u.active === false) continue;
    const session = u.active_session && typeof u.active_session === 'object' ? u.active_session : null;
    if (!isSessionOnline(session)) continue;

    online.push({
      ...sanitizeUserOutput(u),
      online: true,
      session_id: String(session.id || ''),
      session_last_seen: String(session.last_seen || session.updated_at || session.created_at || ''),
      session_created_at: String(session.created_at || '')
    });
  }

  online.sort((a, b) => String(b.session_last_seen || '').localeCompare(String(a.session_last_seen || '')));
  res.json({ success: true, data: online });
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
  if (!target) throw httpError(404, 'Usuário não encontrado');
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
  if (!target) throw httpError(404, 'Usuário não encontrado');
  const payload = req.body || {};
  const { emailIdx, phoneIdx } = await loadIndexes();

  const oldEmail = normalizeEmail(target.email || '');
  const oldPhone = normalizePhone(target.phone || '');

  if (payload.email !== undefined) {
    const newEmail = normalizeEmail(payload.email);
    if (!isValidEmail(newEmail)) throw httpError(400, 'E-mail inválido');
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


