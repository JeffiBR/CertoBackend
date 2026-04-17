/**
 * Rotas de Revendedores
 */

const express = require('express');
const router = express.Router();
const { RevendedoresModel } = require('../revendedoresModel');
const { storage } = require('../githubStorage');

const revendedoresModel = new RevendedoresModel(storage);

router.get('/', async (req, res) => {
  try {
    const revendedores = await revendedoresModel.getAll();
    res.json({ success: true, count: revendedores.length, data: revendedores });
  } catch (error) {
    console.error('❌ Erro ao buscar revendedores:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const revendedor = await revendedoresModel.getById(id);
    if (!revendedor) return res.status(404).json({ success: false, error: 'Revendedor não encontrado' });
    res.json({ success: true, data: revendedor });
  } catch (error) {
    console.error('❌ Erro ao buscar revendedor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const revendedorData = req.body;
    if (!revendedorData.nome) return res.status(400).json({ success: false, error: 'Nome do revendedor é obrigatório' });
    const novoRevendedor = await revendedoresModel.create(revendedorData);
    console.log('✅ Revendedor criado:', novoRevendedor.nome);
    res.status(201).json({ success: true, message: 'Revendedor criado com sucesso', data: novoRevendedor });
  } catch (error) {
    console.error('❌ Erro ao criar revendedor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const revendedorAtualizado = await revendedoresModel.update(id, updates);
    if (!revendedorAtualizado) return res.status(404).json({ success: false, error: 'Revendedor não encontrado' });
    console.log('✅ Revendedor atualizado:', id);
    res.json({ success: true, message: 'Revendedor atualizado com sucesso', data: revendedorAtualizado });
  } catch (error) {
    console.error('❌ Erro ao atualizar revendedor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sucesso = await revendedoresModel.delete(id);
    if (!sucesso) return res.status(404).json({ success: false, error: 'Revendedor não encontrado' });
    console.log('✅ Revendedor removido:', id);
    res.json({ success: true, message: 'Revendedor removido com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao remover revendedor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
