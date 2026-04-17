/**
 * Rotas de Configurações de Precificação por usuário
 */

const express = require('express');
const router = express.Router();
const { storage } = require('../githubStorage');

const FILE_PATH = 'Atelie/configuracoes_usuario.json';

function getDefaultConfig() {
  return {
    tecidos: {},
    forros: {},
    aviamentos: {}
  };
}

function toNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Number(n.toFixed(4));
}

function sanitizeConfig(payload) {
  const defaults = getDefaultConfig();
  const cfg = payload && typeof payload === 'object' ? payload : {};

  const tecidos = {};
  const forros = {};
  const aviamentos = {};

  Object.entries(cfg.tecidos || {}).forEach(([key, value]) => {
    if (!key) return;
    tecidos[String(key)] = toNumber(value);
  });

  Object.entries(cfg.forros || {}).forEach(([key, value]) => {
    if (!key) return;
    forros[String(key)] = toNumber(value);
  });

  Object.entries(cfg.aviamentos || {}).forEach(([key, value]) => {
    if (!key) return;
    const item = value && typeof value === 'object' ? value : {};
    aviamentos[String(key)] = {
      metro: toNumber(item.metro),
      unidade: toNumber(item.unidade)
    };
  });

  return {
    ...defaults,
    tecidos,
    forros,
    aviamentos
  };
}

router.get('/', async (req, res) => {
  try {
    if (!storage.isConfigured()) {
      return res.json({ success: true, data: getDefaultConfig(), source: 'default' });
    }

    const config = await storage.readFile(FILE_PATH);
    if (!config || typeof config !== 'object') {
      return res.json({ success: true, data: getDefaultConfig(), source: 'default' });
    }

    return res.json({ success: true, data: sanitizeConfig(config), source: 'github' });
  } catch (error) {
    console.error('Erro ao buscar configuracoes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    if (!storage.isConfigured()) {
      return res.status(400).json({ success: false, error: 'GitHub Storage nao configurado' });
    }

    const safeConfig = sanitizeConfig(req.body || {});
    const result = await storage.writeFile(FILE_PATH, safeConfig, 'Atualizar configuracoes do usuario');
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Falha ao salvar configuracoes' });
    }

    return res.json({ success: true, data: safeConfig });
  } catch (error) {
    console.error('Erro ao salvar configuracoes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

