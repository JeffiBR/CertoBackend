/**
 * Rotas de Precificacao (Atelie)
 */

const express = require('express');
const router = express.Router();
const { PrecificacaoModel } = require('../precificacaoModel');
const { storage } = require('../githubStorage');
const path = require('path');

const precificacaoModel = new PrecificacaoModel(storage);

const MAX_IMAGE_BYTES = 900 * 1024; // limite seguro para GitHub Contents API

function extractBase64Image(payload) {
  if (!payload || !payload.foto_base64) return null;
  const raw = payload.foto_base64;
  const match = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (match) {
    return { mime: match[1], base64: match[2] };
  }
  const fallbackMime = payload.foto_tipo || null;
  return { mime: fallbackMime, base64: raw };
}

function getExtFromMimeOrName(mime, name) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  };
  if (mime && map[mime.toLowerCase()]) return map[mime.toLowerCase()];
  const ext = path.extname(name || '').replace('.', '').toLowerCase();
  return ext || 'png';
}

function slugify(value) {
  return (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function salvarImagemPrecificacao({ id, nome_produto, fotoInfo, fotoNome }) {
  const safeName = slugify(nome_produto) || 'produto';
  const ext = getExtFromMimeOrName(fotoInfo.mime, fotoNome);
  const fileName = `precificacao_${id}_${Date.now()}_${safeName}.${ext}`;
  const filePath = `Atelie/images/${fileName}`;

  const res = await storage.writeBinaryFile(
    filePath,
    fotoInfo.base64,
    `Upload imagem precificacao ${id}`
  );

  if (!res || !res.success) {
    throw new Error(res && res.error ? res.error : 'Falha ao salvar imagem no GitHub');
  }

  return {
    foto_url: res.download_url || res.url || null,
    foto_path: filePath,
    foto_nome: fotoNome || null,
    foto_tipo: fotoInfo.mime || null,
    foto_tamanho: fotoInfo.bytes || null
  };
}

router.get('/', async (req, res) => {
  try {
    const itens = await precificacaoModel.getAll();
    res.json({ success: true, count: itens.length, data: itens });
  } catch (error) {
    console.error('❌ Erro ao buscar precificações:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await precificacaoModel.getById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Precificacao nao encontrada' });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('❌ Erro ao buscar precificação:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.nome_produto) {
      return res.status(400).json({ success: false, error: 'Nome do produto é obrigatório' });
    }

    const fotoInfo = extractBase64Image(payload);
    if (fotoInfo && storage.isConfigured()) {
      const bytes = Buffer.from(fotoInfo.base64, 'base64').length;
      if (bytes > MAX_IMAGE_BYTES) {
        return res.status(413).json({
          success: false,
          error: `Imagem muito grande. Limite aproximado: ${Math.floor(MAX_IMAGE_BYTES / 1024)}KB.`
        });
      }
      fotoInfo.bytes = bytes;
    }

    const payloadToSave = { ...payload };
    if (storage.isConfigured()) {
      delete payloadToSave.foto_base64;
      delete payloadToSave.foto_nome;
      delete payloadToSave.foto_tipo;
    }

    const novoItem = await precificacaoModel.create(payloadToSave);
    console.log('✅ Precificacao criada:', novoItem.id);

    let finalItem = novoItem;
    if (fotoInfo && storage.isConfigured()) {
      const imageMeta = await salvarImagemPrecificacao({
        id: novoItem.id,
        nome_produto: novoItem.nome_produto,
        fotoInfo,
        fotoNome: payload.foto_nome
      });
      const atualizado = await precificacaoModel.update(novoItem.id, imageMeta);
      if (atualizado) finalItem = atualizado;
    }

    res.status(201).json({ success: true, id: finalItem.id, data: finalItem });
  } catch (error) {
    console.error('❌ Erro ao criar precificação:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    const fotoInfo = extractBase64Image(updates);
    if (fotoInfo && storage.isConfigured()) {
      const bytes = Buffer.from(fotoInfo.base64, 'base64').length;
      if (bytes > MAX_IMAGE_BYTES) {
        return res.status(413).json({
          success: false,
          error: `Imagem muito grande. Limite aproximado: ${Math.floor(MAX_IMAGE_BYTES / 1024)}KB.`
        });
      }
      fotoInfo.bytes = bytes;

      delete updates.foto_base64;
      delete updates.foto_nome;
      delete updates.foto_tipo;

      const imageMeta = await salvarImagemPrecificacao({
        id,
        nome_produto: updates.nome_produto || '',
        fotoInfo,
        fotoNome: req.body ? req.body.foto_nome : null
      });

      Object.assign(updates, imageMeta);
    }
    const atualizado = await precificacaoModel.update(id, updates);
    if (!atualizado) return res.status(404).json({ success: false, error: 'Precificacao nao encontrada' });
    res.json({ success: true, data: atualizado });
  } catch (error) {
    console.error('❌ Erro ao atualizar precificacao:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await precificacaoModel.delete(id);
    if (!ok) return res.status(404).json({ success: false, error: 'Precificacao nao encontrada' });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao remover precificacao:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
