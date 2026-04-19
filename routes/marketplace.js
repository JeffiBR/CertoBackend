/**
 * Rotas de Marketplace
 * - Cliente/Admin: listar produtos ativos, criar/listar pedidos
 * - Desenvolvedor: gerenciar produtos e atualizar pedidos
 */

const express = require('express');
const { storage } = require('../githubStorage');
const { MarketplaceModel } = require('../marketplaceModel');

const router = express.Router();
const model = new MarketplaceModel(storage);

const ALLOWED_STATUS = new Set([
  'aguardando_pagamento',
  'em_processo',
  'entregue',
  'erro',
  'corrigido',
  // compatibilidade com status antigos
  'concluido',
  'cancelado'
]);

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

function parseMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function sanitizeText(value, maxLen) {
  const text = String(value || '').trim();
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function sanitizeCategory(value) {
  return sanitizeText(value, 80);
}

function sanitizeImageUrl(value) {
  const url = sanitizeText(value, 600000); // aceita data url pequena/media
  if (!url) return '';
  if (url.startsWith('data:image/')) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return '';
}

function sanitizeProductPayload(body, allowPartial) {
  const payload = body && typeof body === 'object' ? body : {};
  const out = {};

  if (!allowPartial || payload.nome !== undefined) {
    out.nome = sanitizeText(payload.nome, 120);
    if (!out.nome) throw new Error('Informe o nome do produto');
  }
  if (!allowPartial || payload.descricao !== undefined) {
    out.descricao = sanitizeText(payload.descricao, 1200);
    if (!out.descricao) throw new Error('Informe a descricao do produto');
  }
  if (!allowPartial || payload.imagem_url !== undefined) {
    out.imagem_url = sanitizeImageUrl(payload.imagem_url);
    if (!out.imagem_url) throw new Error('Informe uma imagem valida (URL https ou data:image)');
  }
  if (!allowPartial || payload.valor !== undefined) {
    out.valor = parseMoney(payload.valor);
    if (!(out.valor > 0)) throw new Error('Informe um valor valido para o produto');
  }
  if (!allowPartial || payload.ativo !== undefined) {
    out.ativo = payload.ativo !== false;
  }
  if (!allowPartial || payload.categoria !== undefined) {
    out.categoria = sanitizeCategory(payload.categoria);
    if (!out.categoria) throw new Error('Informe a categoria do produto');
  }

  return out;
}

function formatOrderItem(product, qty) {
  const quantidade = Math.max(1, Math.floor(Number(qty || 0)));
  const unitPrice = parseMoney(product.valor);
  return {
    product_id: product.id,
    nome: String(product.nome || ''),
    descricao: String(product.descricao || ''),
    categoria: String(product.categoria || ''),
    imagem_url: String(product.imagem_url || ''),
    quantidade,
    valor_unitario: unitPrice,
    valor_total: parseMoney(unitPrice * quantidade)
  };
}

router.get('/products', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuário não autenticado' });

    const items = await model.getProducts();
    const ordered = items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    if (isDeveloper(req)) {
      return res.json({ success: true, count: ordered.length, data: ordered });
    }
    const activeOnly = ordered.filter((p) => p && p.ativo !== false);
    return res.json({ success: true, count: activeOnly.length, data: activeOnly });
  } catch (error) {
    console.error('Erro ao listar produtos do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    const categories = await model.getCategories();
    return res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    console.error('Erro ao listar categorias do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode criar categorias' });
    }
    const categoria = sanitizeCategory(req.body && req.body.categoria);
    if (!categoria) return res.status(400).json({ success: false, error: 'Informe a categoria' });
    const current = await model.getCategories();
    if (current.some((x) => x.toLowerCase() === categoria.toLowerCase())) {
      return res.status(409).json({ success: false, error: 'Categoria ja cadastrada' });
    }
    const saved = await model.saveCategories([...current, categoria], `Criar categoria marketplace: ${categoria}`);
    return res.status(201).json({ success: true, data: saved });
  } catch (error) {
    console.error('Erro ao criar categoria do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/categories/:categoria', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode excluir categorias' });
    }
    const categoria = sanitizeCategory(req.params.categoria);
    if (!categoria) return res.status(400).json({ success: false, error: 'Categoria inválida' });
    const current = await model.getCategories();
    const next = current.filter((x) => x.toLowerCase() !== categoria.toLowerCase());
    if (next.length === current.length) {
      return res.status(404).json({ success: false, error: 'Categoria não encontrada' });
    }
    const saved = await model.saveCategories(next, `Excluir categoria marketplace: ${categoria}`);
    return res.json({ success: true, data: saved });
  } catch (error) {
    console.error('Erro ao excluir categoria do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/products', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode criar produtos' });
    }
    const payload = sanitizeProductPayload(req.body, false);
    const created = await model.createProduct(payload);
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Erro ao criar produto do marketplace:', error);
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.patch('/products/:id', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode atualizar produtos' });
    }
    const payload = sanitizeProductPayload(req.body, true);
    const updated = await model.updateProduct(req.params.id, payload);
    if (!updated) return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Erro ao atualizar produto do marketplace:', error);
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode excluir produtos' });
    }
    const removed = await model.deleteProduct(req.params.id);
    if (!removed) return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    return res.json({ success: true, data: { id: removed.id } });
  } catch (error) {
    console.error('Erro ao excluir produto do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuário não autenticado' });

    const items = await model.getOrders();
    const ordered = items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    if (isDeveloper(req)) {
      return res.json({ success: true, count: ordered.length, data: ordered });
    }
    const mine = ordered.filter((o) => String(o.user_id || '') === userId);
    return res.json({ success: true, count: mine.length, data: mine });
  } catch (error) {
    console.error('Erro ao listar pedidos do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/orders', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Usuário não autenticado' });

    const payload = req.body || {};
    const incomingItems = Array.isArray(payload.items) ? payload.items : [];
    if (!incomingItems.length) {
      return res.status(400).json({ success: false, error: 'Adicione ao menos um item para finalizar a compra' });
    }

    const allProducts = await model.getProducts();
    const productsById = new Map(allProducts.map((p) => [String(p.id), p]));

    const normalized = [];
    incomingItems.forEach((item) => {
      const productId = String(item && item.product_id ? item.product_id : '').trim();
      const qty = Math.max(1, Math.floor(Number(item && item.quantidade ? item.quantidade : 0)));
      if (!productId || !qty) return;
      const existing = normalized.find((x) => String(x.product_id) === productId);
      if (existing) existing.quantidade += qty;
      else normalized.push({ product_id: productId, quantidade: qty });
    });

    if (!normalized.length) {
      return res.status(400).json({ success: false, error: 'Itens inválidos no carrinho' });
    }

    const orderItems = [];
    normalized.forEach((item) => {
      const product = productsById.get(String(item.product_id));
      if (!product || product.ativo === false) return;
      orderItems.push(formatOrderItem(product, item.quantidade));
    });

    if (!orderItems.length) {
      return res.status(409).json({ success: false, error: 'Os produtos selecionados não estão disponíveis no momento' });
    }

    const subtotal = parseMoney(orderItems.reduce((acc, item) => acc + parseMoney(item.valor_total), 0));
    const desconto = 0;
    const total = parseMoney(subtotal - desconto);
    const created = await model.createOrder({
      user_id: userId,
      cliente_nome: getUserName(req) || 'Cliente',
      items: orderItems,
      subtotal,
      desconto,
      total,
      status: 'aguardando_pagamento',
      comentario_cliente: sanitizeText(payload.comentario_cliente, 500),
      comentario_desenvolvedor: ''
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Erro ao criar pedido do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/orders/:id/admin', async (req, res) => {
  try {
    if (!isDeveloper(req)) {
      return res.status(403).json({ success: false, error: 'Apenas desenvolvedor pode atualizar pedidos' });
    }
    const payload = req.body || {};
    const status = String(payload.status || '').trim().toLowerCase();
    if (!ALLOWED_STATUS.has(status)) {
      return res.status(400).json({ success: false, error: 'Status inválido para pedido. Use aguardando_pagamento, em_processo, entregue, erro ou corrigido' });
    }
    const comentario = sanitizeText(payload.comentario_desenvolvedor, 500);
    const updated = await model.updateOrder(req.params.id, {
      status,
      comentario_desenvolvedor: comentario
    });
    if (!updated) return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Erro ao atualizar pedido do marketplace:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

