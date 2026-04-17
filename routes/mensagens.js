/**
 * Rotas de Mensagens de Cobrança
 */

const express = require('express');
const router = express.Router();
const { MensagensModel } = require('../mensagensModel');
const { storage } = require('../githubStorage');

const mensagensModel = new MensagensModel(storage);

router.get('/', async (req, res) => {
  try {
    const mensagens = await mensagensModel.getAll();
    res.json({ success: true, count: mensagens.length, data: mensagens });
  } catch (error) {
    console.error('❌ Erro ao buscar mensagens:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const mensagens = req.body;
    if (!Array.isArray(mensagens)) {
      return res.status(400).json({ success: false, error: 'Formato inválido: envie um array de mensagens' });
    }
    const result = await mensagensModel.saveAll(mensagens);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, message: 'Mensagens atualizadas', data: mensagens });
  } catch (error) {
    console.error('❌ Erro ao salvar mensagens:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const mensagemAtualizada = await mensagensModel.updateById(id, updates);
    if (!mensagemAtualizada) {
      return res.status(404).json({ success: false, error: 'Mensagem não encontrada' });
    }
    res.json({ success: true, message: 'Mensagem atualizada', data: mensagemAtualizada });
  } catch (error) {
    console.error('❌ Erro ao atualizar mensagem:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

