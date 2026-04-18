/**
 * Rotas de Recarga de Celular
 * - Cliente: criar e listar suas recargas
 * - Desenvolvedor: listar todas, atualizar status/comentario e configurar operadoras/precos
 */

const express = require('express');
const { RecargasCelularModel } = require('../recargasCelularModel');
const { storage } = require('../githubStorage');

const router = express.Router();
const model = new RecargasCelularModel(storage);

const ALLOWED_STATUS = new Set(['aguardando_pagamento', 'em_processo', 'concluido', 'erro']);
const BASE_OPERADORAS = ['Tim', 'Vivo', 'Claro'];
const CONFIG_FILE_PATH = 'Atelie/recargas_celular_config.json';
const PIX_CONFIG_FILE_PATH = 'Atelie/recargas_pix_config.json';

function getUserId(req) {
  return String(req.headers['x-user-id'] || req.headers['x-clerk-user-id'] || '').trim().toLowerCase();
}

function getUserName(req) {
  return String(req.headers['x-user-name'] || '').trim();
}

function getUserRole(req) {
  return String(req.headers['x-user-role'] || '').trim().toLowerCase();
}

function isDeveloper(req) {
  return getUserRole(req) === 'desenvolvedor' || getUserRole(req) === 'developer';
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function parseMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function normalizeOperadora(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'tim') return 'Tim';
  if (raw === 'vivo') return 'Vivo';
  if (raw === 'claro') return 'Claro';
  return '';
}

function sanitizePlan(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const credito = parseMoney(item.credito);
  const paga = parseMoney(item.paga);
  if (credito <= 0 || paga <= 0) return null;
  return { credito, paga };
}

function dedupePlans(plans) {
  const seen = new Set();
  const out = [];
  plans.forEach((plan) => {
    const safe = sanitizePlan(plan);
    if (!safe) return;
    const key = `${safe.credito.toFixed(2)}_${safe.paga.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(safe);
  });
  return out.sort((a, b) => a.credito - b.credito);
}

function getDefaultConfig() {
  const plans = [10, 15, 20, 30, 50].map((v) => ({ credito: v, paga: v }));
  return {
    operadoras: {
      Tim: { ativa: true, planos: plans },
      Vivo: { ativa: true, planos: plans },
      Claro: { ativa: true, planos: plans }
    }
  };
}

function sanitizePixConfig(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const keyRaw = String(payload.pix_key || payload.chave_pix || '').trim();
  const merchantRaw = String(payload.pix_merchant_name || payload.merchant_name || 'PRECO CERTO').trim();
  const cityRaw = String(payload.pix_city || payload.city || 'ARAPIRACA').trim();

  return {
    pix_key: keyRaw,
    pix_merchant_name: merchantRaw || 'PRECO CERTO',
    pix_city: cityRaw || 'ARAPIRACA'
  };
}

function sanitizeConfig(data) {
  const cfg = data && typeof data === 'object' ? data : {};
  const defaults = getDefaultConfig();
  const output = { operadoras: {} };

  // Compatibilidade com formato antigo: { valores: [10,20...] }
  const legacyValores = Array.isArray(cfg.valores)
    ? cfg.valores
      .map((v) => parseMoney(v))
      .filter((v) => v > 0)
      .map((v) => ({ credito: v, paga: v }))
    : [];

  BASE_OPERADORAS.forEach((op) => {
    const source = (cfg.operadoras && cfg.operadoras[op] && typeof cfg.operadoras[op] === 'object')
      ? cfg.operadoras[op]
      : {};
    const ativa = source.ativa !== false;
    const planosRaw = Array.isArray(source.planos) && source.planos.length
      ? source.planos
      : (legacyValores.length ? legacyValores : defaults.operadoras[op].planos);
    const planos = dedupePlans(planosRaw);
    output.operadoras[op] = {
      ativa,
      planos: planos.length ? planos : defaults.operadoras[op].planos
    };
  });

  return output;
}

async function loadConfig() {
  if (!storage.isConfigured()) return getDefaultConfig();
  const raw = await storage.readFile(CONFIG_FILE_PATH, { skipNamespace: true, skipBackup: true });
  return sanitizeConfig(raw);
}

async function saveConfig(config) {
  if (!storage.isConfigured()) throw new Error('GitHub Storage nao configurado');
  const safe = sanitizeConfig(config);
  const result = await storage.writeFile(
    CONFIG_FILE_PATH,
    safe,
    'Atualizar configuracoes de recarga celular',
    { skipNamespace: true, skipBackup: true }
  );
  if (!result || !result.success) {
    throw new Error(result && result.error ? result.error : 'Falha ao salvar configuracoes de recarga');
  }
  return safe;
}

async function loadPixConfig() {
  if (!storage.isConfigured()) {
    return sanitizePixConfig({
      pix_key: process.env.DEFAULT_PIX_KEY || '82999158412',
      pix_merchant_name: process.env.DEFAULT_PIX_MERCHANT_NAME || 'PRECO CERTO',
      pix_city: process.env.DEFAULT_PIX_CITY || 'ARAPIRACA'
    });
  }
  const raw = await storage.readFile(PIX_CONFIG_FILE_PATH, { skipNamespace: true, skipBackup: true });
  if (!raw) {
    return sanitizePixConfig({
      pix_key: process.env.DEFAULT_PIX_KEY || '82999158412',
      pix_merchant_name: process.env.DEFAULT_PIX_MERCHANT_NAME || 'PRECO CERTO',
      pix_city: process.env.DEFAULT_PIX_CITY || 'ARAPIRACA'
    });
  }
  return sanitizePixConfig(raw);
}

async function savePixConfig(config) {
  if (!storage.isConfigured()) throw new Error('GitHub Storage nao configurado');
  const safe = sanitizePixConfig(config);
  if (!safe.pix_key) throw new Error('Informe a chave PIX');
  const result = await storage.writeFile(
    PIX_CONFIG_FILE_PATH,
    safe,
    'Atualizar configuracoes PIX da recarga celular',
    { skipNamespace: true, skipBackup: true }
  );
  if (!result || !result.success) {
    throw new Error(result && result.error ? result.error : 'Falha ao salvar configuracoes PIX');
  }
  return safe;
}

function findPlanoByCredito(planos, credito) {
  const key = parseMoney(credito).toFixed(2);
  return (Array.isArray(planos) ? planos : []).find((p) => parseMoney(p.credito).toFixed(2) === key) || null;
}

router.get('/config', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuario nao autenticado' });
    const cfg = await loadConfig();
    return res.json({ success: true, data: cfg });
  } catch (error) {
    console.error('Erro ao buscar configuracao de recargas:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode alterar configuracoes de recarga' });
    }
    const payload = req.body || {};
    const saved = await saveConfig(payload);
    return res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Erro ao salvar configuracao de recargas:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/pix-config', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuario nao autenticado' });
    const cfg = await loadPixConfig();
    return res.json({ success: true, data: cfg });
  } catch (error) {
    console.error('Erro ao buscar configuracao PIX:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/pix-config', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode alterar configuracoes PIX' });
    }
    const payload = req.body || {};
    const saved = await savePixConfig(payload);
    return res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Erro ao salvar configuracao PIX:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuario nao autenticado' });

    const items = await model.getAll();
    if (isDeveloper(req)) {
      return res.json({ success: true, count: items.length, data: items });
    }

    const mine = items.filter((r) => String(r.user_id || '') === userId);
    return res.json({ success: true, count: mine.length, data: mine });
  } catch (error) {
    console.error('Erro ao buscar recargas:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuario nao autenticado' });

    const payload = req.body || {};
    const numero = normalizePhone(payload.numero);
    const operadora = normalizeOperadora(payload.operadora);
    const valorCredito = parseMoney(payload.valor_credito || payload.valor || 0);
    const comentarioCliente = String(payload.comentario_cliente || '').trim();
    const cfg = await loadConfig();

    if (numero.length < 10 || numero.length > 11) {
      return res.status(400).json({ success: false, error: 'Numero de celular invalido (com DDD)' });
    }
    if (!operadora) {
      return res.status(400).json({ success: false, error: 'Operadora invalida. Use Tim, Vivo ou Claro' });
    }

    const opCfg = cfg.operadoras && cfg.operadoras[operadora] ? cfg.operadoras[operadora] : null;
    if (!opCfg) {
      return res.status(400).json({ success: false, error: 'Operadora nao configurada' });
    }
    if (opCfg.ativa === false) {
      return res.status(409).json({ success: false, error: `Operadora ${operadora} inativa no momento` });
    }

    const plano = findPlanoByCredito(opCfg.planos, valorCredito);
    if (!plano) {
      return res.status(400).json({ success: false, error: 'Valor de credito nao permitido para esta operadora' });
    }

    const created = await model.create({
      user_id: userId,
      cliente_nome: getUserName(req) || 'Cliente',
      numero,
      operadora,
      valor_credito: plano.credito,
      valor_pago: plano.paga,
      valor: plano.paga, // compatibilidade com telas antigas
      status: 'aguardando_pagamento',
      comentario_cliente: comentarioCliente,
      comentario_desenvolvedor: ''
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Erro ao criar recarga:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id/admin', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode atualizar recargas' });
    }

    const { id } = req.params;
    const payload = req.body || {};
    const status = String(payload.status || '').trim().toLowerCase();
    const comentario = String(payload.comentario_desenvolvedor || '').trim();

    if (!ALLOWED_STATUS.has(status)) {
      return res.status(400).json({ success: false, error: 'Status invalido. Use aguardando_pagamento, em_processo, concluido ou erro' });
    }

    const updated = await model.update(id, {
      status,
      comentario_desenvolvedor: comentario
    });

    if (!updated) return res.status(404).json({ success: false, error: 'Recarga nao encontrada' });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Erro ao atualizar recarga:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
