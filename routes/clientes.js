/**
 * Rotas de Clientes - ajuste e limpeza
 */

const express = require('express');
const router = express.Router();
const { clientesModel, storage } = require('../githubStorage');

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
  vencimento.setHours(0, 0, 0, 0);
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

function appendObservacao(atual, texto) {
  const timestamp = new Date().toISOString();
  const linha = `[${timestamp}] ${texto}`;
  if (!atual) return linha;
  return `${atual}\n${linha}`;
}

// Lista todos os clientes
router.get('/', async (req, res) => {
  try {
    const clientes = await clientesModel.getAll();
    const clientesEnriquecidos = clientes.map(enriquecerCliente);
    clientesEnriquecidos.sort((a, b) => a.dias_restantes - b.dias_restantes);
    res.json({
      success: true,
      count: clientesEnriquecidos.length,
      data: clientesEnriquecidos,
      source: storage.isConfigured() ? 'github' : 'mock'
    });
  } catch (error) {
    console.error('❌ Erro ao buscar clientes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Filtros específicos (colocados antes da rota de :id para evitar conflitos)
router.get('/filtro/vencimento/:dias', async (req, res) => {
  try {
    const { dias } = req.params;
    const diasNum = parseInt(dias);
    const clientes = await clientesModel.getAll();
    const clientesFiltrados = clientes.map(enriquecerCliente).filter(c => c.dias_restantes >= 0 && c.dias_restantes <= diasNum);
    res.json({ success: true, count: clientesFiltrados.length, data: clientesFiltrados });
  } catch (error) {
    console.error('❌ Erro ao filtrar clientes por vencimento:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/filtro/status/:status', async (req, res) => {
  try {
    const { status } = req.params;
    const clientes = await clientesModel.getAll();
    const clientesFiltrados = clientes.map(enriquecerCliente).filter(c => c.status === status);
    res.json({ success: true, count: clientesFiltrados.length, data: clientesFiltrados });
  } catch (error) {
    console.error('❌ Erro ao filtrar clientes por status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Busca por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await clientesModel.getById(id);
    if (!cliente) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    res.json({ success: true, data: enriquecerCliente(cliente) });
  } catch (error) {
    console.error('❌ Erro ao buscar cliente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cria cliente
router.post('/', async (req, res) => {
  try {
    const clienteData = req.body || {};

    // Normalizar campos de revendedor: aceitar revendedor (string) ou revendedor_nome + revendedor_numero
    if (clienteData.revendedor_nome || clienteData.revendedor_numero) {
      clienteData.revendedor = clienteData.revendedor_nome || clienteData.revendedor || null;
      clienteData.revendedor_numero = clienteData.revendedor_numero || null;
    }

    if (!clienteData.nome || !clienteData.telefone) {
      return res.status(400).json({ success: false, error: 'Nome e telefone são obrigatórios' });
    }

    const novoCliente = await clientesModel.create(clienteData);
    console.log('✅ Cliente criado:', novoCliente.nome || novoCliente.id);
    res.status(201).json({ success: true, message: 'Cliente criado', data: enriquecerCliente(novoCliente) });
  } catch (error) {
    console.error('❌ Erro ao criar cliente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualiza cliente
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    // Normalizar possíveis campos de revendedor na atualização
    if (updates.revendedor_nome || updates.revendedor_numero) {
      updates.revendedor = updates.revendedor_nome || updates.revendedor || null;
      updates.revendedor_numero = updates.revendedor_numero || null;
    }

    const clienteAtualizado = await clientesModel.update(id, updates);
    if (!clienteAtualizado) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    console.log('✅ Cliente atualizado:', id);
    res.json({ success: true, message: 'Cliente atualizado com sucesso', data: enriquecerCliente(clienteAtualizado) });
  } catch (error) {
    console.error('❌ Erro ao atualizar cliente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Migrar cliente para outro servidor (gera observacao)
router.post('/:id/migrar-servidor', async (req, res) => {
  try {
    const { id } = req.params;
    const { servidor, id_servidor } = req.body || {};
    if (!servidor) return res.status(400).json({ success: false, error: 'Servidor eh obrigatorio' });

    const cliente = await clientesModel.getById(id);
    if (!cliente) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });

    const obs = appendObservacao(
      cliente.observacoes,
      `Migracao de servidor: ${cliente.servidor || '-'} -> ${servidor}${id_servidor ? ` (ID ${id_servidor})` : ''}`
    );

    const updates = {
      servidor,
      ...(id_servidor ? { id_servidor } : {}),
      observacoes: obs
    };

    const clienteAtualizado = await clientesModel.update(id, updates);
    res.json({ success: true, message: 'Servidor atualizado', data: enriquecerCliente(clienteAtualizado) });
  } catch (error) {
    console.error('❌ Erro ao migrar servidor:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mudar plano do cliente (gera observacao)
router.post('/:id/mudar-plano', async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo_plano, valor_plano } = req.body || {};
    if (!tipo_plano) return res.status(400).json({ success: false, error: 'Plano eh obrigatorio' });

    const cliente = await clientesModel.getById(id);
    if (!cliente) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });

    const obs = appendObservacao(
      cliente.observacoes,
      `Mudanca de plano: ${cliente.tipo_plano || '-'} -> ${tipo_plano}${valor_plano !== undefined ? ` (R$ ${valor_plano})` : ''}`
    );

    const updates = {
      tipo_plano,
      ...(valor_plano !== undefined ? { valor_plano } : {}),
      observacoes: obs
    };

    const clienteAtualizado = await clientesModel.update(id, updates);
    res.json({ success: true, message: 'Plano atualizado', data: enriquecerCliente(clienteAtualizado) });
  } catch (error) {
    console.error('❌ Erro ao mudar plano:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove cliente
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sucesso = await clientesModel.delete(id);
    if (!sucesso) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    console.log('✅ Cliente removido:', id);
    res.json({ success: true, message: 'Cliente removido com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao remover cliente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/clear-cache', async (req, res) => {
  try {
    storage.clearCache();
    res.json({ success: true, message: 'Cache limpo com sucesso' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

