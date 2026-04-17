/**
 * Rotas de Servidores
 */

const express = require('express');
const router = express.Router();
const { ServidoresModel } = require('../services/servidoresModel');
const { storage } = require('../services/githubStorage');

const servidoresModel = new ServidoresModel(storage);

// =============================================
// ROTAS
// =============================================

/**
 * GET /api/servidores
 * Lista todos os servidores
 */
router.get('/', async (req, res) => {
  try {
    const servidores = await servidoresModel.getAll();
    
    res.json({
      success: true,
      count: servidores.length,
      data: servidores
    });
  } catch (error) {
    console.error('❌ Erro ao buscar servidores:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/servidores/:id
 * Busca um servidor por ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const servidor = await servidoresModel.getById(id);
    
    if (!servidor) {
      return res.status(404).json({
        success: false,
        error: 'Servidor não encontrado'
      });
    }
    
    res.json({
      success: true,
      data: servidor
    });
  } catch (error) {
    console.error('❌ Erro ao buscar servidor:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/servidores
 * Cria um novo servidor
 */
router.post('/', async (req, res) => {
  try {
    const servidorData = req.body;
    
    // Validação básica
    if (!servidorData.nome) {
      return res.status(400).json({
        success: false,
        error: 'Nome do servidor é obrigatório'
      });
    }
    
    const novoServidor = await servidoresModel.create(servidorData);
    
    console.log('✅ Servidor criado:', novoServidor.nome);
    
    res.status(201).json({
      success: true,
      message: 'Servidor criado com sucesso',
      data: novoServidor
    });
  } catch (error) {
    console.error('❌ Erro ao criar servidor:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /api/servidores/:id
 * Atualiza um servidor
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const servidorAtualizado = await servidoresModel.update(id, updates);
    
    if (!servidorAtualizado) {
      return res.status(404).json({
        success: false,
        error: 'Servidor não encontrado'
      });
    }
    
    console.log('✅ Servidor atualizado:', id);
    
    res.json({
      success: true,
      message: 'Servidor atualizado com sucesso',
      data: servidorAtualizado
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar servidor:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/servidores/:id
 * Remove um servidor
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sucesso = await servidoresModel.delete(id);
    
    if (!sucesso) {
      return res.status(404).json({
        success: false,
        error: 'Servidor não encontrado'
      });
    }
    
    console.log('✅ Servidor removido:', id);
    
    res.json({
      success: true,
      message: 'Servidor removido com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao remover servidor:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
