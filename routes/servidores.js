/**
 * Rotas de Servidores (paths ajustados)
 */

const express = require('express');
const router = express.Router();
const { ServidoresModel } = require('../servidoresModel');
const { storage } = require('../githubStorage');

const servidoresModel = new ServidoresModel(storage);

router.get('/', async (req, res) => {
  try {
    const servidores = await servidoresModel.getAll();
    res.json({ success: true, count: servidores.length, data: servidores });
  } catch (error) {
    console.error('❌ Erro ao buscar servidores:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const servidor = await servidoresModel.getById(id);
    if (!servidor) return res.status(404).json({ success: false, error: 'Servidor não encontrado' });
    res.json({ success: true, data: servidor });
  } catch (error) {
    console.error('❌ Erro ao buscar servidor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const servidorData = req.body;
    if (!servidorData.nome) return res.status(400).json({ success: false, error: 'Nome do servidor é obrigatório' });
    const novoServidor = await servidoresModel.create(servidorData);
    console.log('✅ Servidor criado:', novoServidor.nome);
    res.status(201).json({ success: true, message: 'Servidor criado com sucesso', data: novoServidor });
  } catch (error) {
    console.error('❌ Erro ao criar servidor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const servidorAtualizado = await servidoresModel.update(id, updates);
    if (!servidorAtualizado) return res.status(404).json({ success: false, error: 'Servidor não encontrado' });
    console.log('✅ Servidor atualizado:', id);
    res.json({ success: true, message: 'Servidor atualizado com sucesso', data: servidorAtualizado });
  } catch (error) {
    console.error('❌ Erro ao atualizar servidor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sucesso = await servidoresModel.delete(id);
    if (!sucesso) return res.status(404).json({ success: false, error: 'Servidor não encontrado' });
    console.log('✅ Servidor removido:', id);
    res.json({ success: true, message: 'Servidor removido com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao remover servidor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
