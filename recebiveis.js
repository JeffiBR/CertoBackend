/**
 * Rotas de Recebiveis (Atelie)
 */

const express = require('express');
const router = express.Router();
const { RecebiveisModel } = require('../recebiveisModel');
const { storage } = require('../githubStorage');

const recebiveisModel = new RecebiveisModel(storage);

router.get('/', async (req, res) => {
  try {
    const itens = await recebiveisModel.getAll();
    res.json({ success: true, count: itens.length, data: itens });
  } catch (error) {
    console.error('Erro ao buscar recebiveis:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await recebiveisModel.getById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Recebível não encontrado' });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Erro ao buscar recebivel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.comprador || !payload.vendedor) {
      return res.status(400).json({ success: false, error: 'Comprador e vendedor sao obrigatorios' });
    }

    const novoItem = await recebiveisModel.create(payload);
    console.log('Recebível criado:', novoItem.id);
    res.status(201).json({ success: true, id: novoItem.id, data: novoItem });
  } catch (error) {
    console.error('Erro ao criar recebivel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    const atualizado = await recebiveisModel.update(id, updates);
    if (!atualizado) return res.status(404).json({ success: false, error: 'Recebível não encontrado' });
    res.json({ success: true, data: atualizado });
  } catch (error) {
    console.error('Erro ao atualizar recebivel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await recebiveisModel.delete(id);
    if (!ok) return res.status(404).json({ success: false, error: 'Recebível não encontrado' });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover recebivel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
