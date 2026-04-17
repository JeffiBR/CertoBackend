/**
 * Rotas de Clientes - Apenas GitHub Storage
 */

const express = require('express');
const router = express.Router();
const { clientesModel, storage } = require('../services/githubStorage');

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

function formatarData(data) {
  if (!data) return '-';
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

function calcularDiasRestantes(dataVencimento) {
  if (!dataVencimento) return 0;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const vencimento = new Date(dataVencimento);
  // considerar vencimento às 23:00 do dia informado
  vencimento.setHours(23, 0, 0, 0);
  const diffTime = vencimento.getTime() - hoje.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function obterStatusCliente(diasRestantes) {
  if (diasRestantes > 7) return 'ativo';
  if (diasRestantes >= 0) return 'pendente';
  return 'expirado';
}

function enriquecerCliente(cliente) {
  const diasRestantes = calcularDiasRestantes(cliente.data_vencimento);
  const status = obterStatusCliente(diasRestantes);
  
  return {
    ...cliente,
    dias_restantes: diasRestantes,
    status: status,
    data_vencimento_formatada: formatarData(cliente.data_vencimento)
  };
}

// =============================================
// ROTAS
// =============================================

/**
 * GET /api/clientes
 * Lista todos os clientes
 */
router.get('/', async (req, res) => {
  try {
    const clientes = await clientesModel.getAll();
    
    // Enriquecer dados dos clientes
    const clientesEnriquecidos = clientes.map(enriquecerCliente);
    
    // Ordenar por dias restantes
    clientesEnriquecidos.sort((a, b) => a.dias_restantes - b.dias_restantes);
    
    res.json({
      success: true,
      count: clientesEnriquecidos.length,
      data: clientesEnriquecidos,
      source: storage.isConfigured() ? 'github' : 'mock'
    });
  } catch (error) {
    console.error('❌ Erro ao buscar clientes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/clientes/:id
 * Busca um cliente por ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await clientesModel.getById(id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }
    
    res.json({
      success: true,
      data: enriquecerCliente(cliente)
    });
  } catch (error) {
    console.error('❌ Erro ao buscar cliente:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/clientes
 * Cria um novo cliente
 */
router.post('/', async (req, res) => {
  try {
    const clienteData = req.body;
    
    // Validação básica
    if (!clienteData.nome || !clienteData.telefone) {
      return res.status(400).json({
        success: false,
        error: 'Nome e telefone são obrigatórios'
      });
    }
    
    const novoCliente = await clientesModel.create(clienteData);
    
    console.log('✅ Cliente criado:', novoCliente.nome);
    
    res.status(201).json({
      success: true,
      message: 'Cliente criado com sucesso',
      data: enriquecerCliente(novoCliente)
    });
  } catch (error) {
    console.error('❌ Erro ao criar cliente:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PATCH /api/clientes/:id
 * Atualiza um cliente
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const clienteAtualizado = await clientesModel.update(id, updates);
    
    if (!clienteAtualizado) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }
    
    console.log('✅ Cliente atualizado:', id);
    
    res.json({
      success: true,
      message: 'Cliente atualizado com sucesso',
      data: enriquecerCliente(clienteAtualizado)
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar cliente:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/clientes/:id
 * Remove um cliente
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sucesso = await clientesModel.delete(id);
    
    if (!sucesso) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }
    
    console.log('✅ Cliente removido:', id);
    
    res.json({
      success: true,
      message: 'Cliente removido com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao remover cliente:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/clientes/filtro/status/:status
 * Filtra clientes por status (ativo, pendente, expirado)
 */
router.get('/filtro/status/:status', async (req, res) => {
  try {
    const { status } = req.params;
    
    const clientes = await clientesModel.getAll();
    
    // Filtrar por status
    const clientesFiltrados = clientes
      .map(enriquecerCliente)
      .filter(c => c.status === status);
    
    res.json({
      success: true,
      count: clientesFiltrados.length,
      data: clientesFiltrados
    });
  } catch (error) {
    console.error('❌ Erro ao filtrar clientes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/clientes/filtro/vencimento/:dias
 * Filtra clientes por proximidade de vencimento
 */
router.get('/filtro/vencimento/:dias', async (req, res) => {
  try {
    const { dias } = req.params;
    const diasNum = parseInt(dias);
    
    const clientes = await clientesModel.getAll();
    
    // Filtrar por dias restantes
    const clientesFiltrados = clientes
      .map(enriquecerCliente)
      .filter(c => c.dias_restantes >= 0 && c.dias_restantes <= diasNum);
    
    res.json({
      success: true,
      count: clientesFiltrados.length,
      data: clientesFiltrados
    });
  } catch (error) {
    console.error('❌ Erro ao filtrar clientes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/clientes/clear-cache
 * Limpa o cache do GitHub Storage
 */
router.post('/clear-cache', async (req, res) => {
  try {
    storage.clearCache();
    res.json({
      success: true,
      message: 'Cache limpo com sucesso'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
