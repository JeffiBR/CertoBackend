/**
 * Rotas de Renovações - Apenas GitHub Storage
 */

const express = require('express');
const router = express.Router();
const { renovacoesModel, clientesModel, storage } = require('../services/githubStorage');

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

function formatarData(data) {
  if (!data) return '-';
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

function obterNomePlano(plano) {
  const planos = {
    '1_mes_sem_adultos': '1 Mês (Sem Adultos)',
    '1_mes_com_adultos': '1 Mês (Com Adultos)',
    '2_mes_sem_adultos': '2 Meses (Sem Adultos)',
    '2_mes_com_adultos': '2 Meses (Com Adultos)',
    '3_mes_sem_adultos': '3 Meses (Sem Adultos)',
    '3_mes_com_adultos': '3 Meses (Com Adultos)',
    '6_mes_sem_adultos': '6 Meses (Sem Adultos)',
    '6_mes_com_adultos': '6 Meses (Com Adultos)',
    '1_ano_sem_adultos': '1 Ano (Sem Adultos)',
    '1_ano_com_adultos': '1 Ano (Com Adultos)'
  };
  return planos[plano] || plano;
}

function calcularNovoVencimento(dataVencimentoAtual, planoNovo) {
  const hoje = new Date();
  let novaData = new Date(dataVencimentoAtual);
  
  // Se já expirou, começa de hoje
  if (novaData < hoje) {
    novaData = new Date();
  }
  
  switch(planoNovo) {
    case '1_mes_sem_adultos':
    case '1_mes_com_adultos':
      novaData.setMonth(novaData.getMonth() + 1);
      break;
    case '2_mes_sem_adultos':
    case '2_mes_com_adultos':
      novaData.setMonth(novaData.getMonth() + 2);
      break;
    case '3_mes_sem_adultos':
    case '3_mes_com_adultos':
      novaData.setMonth(novaData.getMonth() + 3);
      break;
    case '6_mes_sem_adultos':
    case '6_mes_com_adultos':
      novaData.setMonth(novaData.getMonth() + 6);
      break;
    case '1_ano_sem_adultos':
    case '1_ano_com_adultos':
      novaData.setFullYear(novaData.getFullYear() + 1);
      break;
  }
  
  return novaData.toISOString().split('T')[0];
}

// =============================================
// ROTAS
// =============================================

/**
 * GET /api/renovacoes
 * Lista todas as renovações
 */
router.get('/', async (req, res) => {
  try {
    const renovacoes = await renovacoesModel.getAll();
    
    // Ordenar por data mais recente
    renovacoes.sort((a, b) => 
      new Date(b.data_renovacao) - new Date(a.data_renovacao)
    );
    
    res.json({
      success: true,
      count: renovacoes.length,
      data: renovacoes
    });
  } catch (error) {
    console.error('❌ Erro ao buscar renovações:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/renovacoes/:id
 * Busca uma renovação por ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const renovacoes = await renovacoesModel.getAll();
    const renovacao = renovacoes.find(r => r.id === parseInt(id));
    
    if (!renovacao) {
      return res.status(404).json({
        success: false,
        error: 'Renovação não encontrada'
      });
    }
    
    res.json({
      success: true,
      data: renovacao
    });
  } catch (error) {
    console.error('❌ Erro ao buscar renovação:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/renovacoes/cliente/:clienteId
 * Busca renovações de um cliente específico
 */
router.get('/cliente/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;
    const renovacoes = await renovacoesModel.getByClienteId(clienteId);
    
    res.json({
      success: true,
      count: renovacoes.length,
      data: renovacoes
    });
  } catch (error) {
    console.error('❌ Erro ao buscar renovações do cliente:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/renovacoes
 * Registra uma nova renovação (apenas no histórico)
 */
router.post('/', async (req, res) => {
  try {
    const renovacaoData = req.body;
    
    // Validação
    if (!renovacaoData.cliente_id) {
      return res.status(400).json({
        success: false,
        error: 'ID do cliente é obrigatório'
      });
    }
    
    // Buscar dados do cliente
    const cliente = await clientesModel.getById(renovacaoData.cliente_id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }
    
    // Preparar dados da renovação
    const novaRenovacao = {
      cliente_id: renovacaoData.cliente_id || cliente.id,
      cliente_nome: renovacaoData.cliente_nome || cliente.nome,
      cliente_telefone: renovacaoData.cliente_telefone || cliente.telefone,
      tipo_cliente: renovacaoData.tipo_cliente || cliente.tipo,
      plano_anterior: renovacaoData.plano_anterior || cliente.tipo_plano,
      plano_novo: renovacaoData.plano_novo,
      valor_renovacao: renovacaoData.valor_renovacao,
      data_vencimento_anterior: renovacaoData.data_vencimento_anterior || cliente.data_vencimento,
      data_vencimento_novo: renovacaoData.data_vencimento_novo,
      revendedor: renovacaoData.revendedor || cliente.revendedor,
      servidor: renovacaoData.servidor || cliente.servidor,
      observacoes: renovacaoData.observacoes || null
    };
    
    const renovacaoRegistrada = await renovacoesModel.create(novaRenovacao);
    
    console.log('✅ Renovação registrada:', renovacaoRegistrada.cliente_nome);
    
    res.status(201).json({
      success: true,
      message: 'Renovação registrada com sucesso',
      data: renovacaoRegistrada
    });
  } catch (error) {
    console.error('❌ Erro ao registrar renovação:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/renovacoes/executar
 * Executa uma renovação completa (atualiza cliente + registra histórico)
 */
router.post('/executar', async (req, res) => {
  try {
    const { cliente_id, plano_novo, valor_renovacao } = req.body;
    
    // Validação
    if (!cliente_id || !plano_novo) {
      return res.status(400).json({
        success: false,
        error: 'ID do cliente e novo plano são obrigatórios'
      });
    }
    
    // Buscar cliente
    const cliente = await clientesModel.getById(cliente_id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }
    
    // Calcular novo vencimento
    const novoVencimento = calcularNovoVencimento(cliente.data_vencimento, plano_novo);
    
    // 1. Preparar dados da renovação para histórico
    const dadosRenovacao = {
      cliente_id: cliente.id,
      cliente_nome: cliente.nome,
      cliente_telefone: cliente.telefone,
      tipo_cliente: cliente.tipo,
      plano_anterior: cliente.tipo_plano,
      plano_novo: plano_novo,
      valor_renovacao: valor_renovacao,
      data_vencimento_anterior: cliente.data_vencimento,
      data_vencimento_novo: novoVencimento,
      revendedor: cliente.revendedor,
      servidor: cliente.servidor
    };
    
    // 2. Atualizar cliente
    const dadosAtualizacao = {
      tipo_plano: plano_novo,
      valor_plano: valor_renovacao,
      data_vencimento: novoVencimento
    };
    
    const clienteAtualizado = await clientesModel.update(cliente_id, dadosAtualizacao);
    
    // 3. Registrar renovação no histórico
    const renovacaoRegistrada = await renovacoesModel.create(dadosRenovacao);
    
    console.log('✅ Renovação executada:', cliente.nome);
    console.log(`   Plano: ${obterNomePlano(plano_novo)}`);
    console.log(`   Novo vencimento: ${formatarData(novoVencimento)}`);
    
    res.json({
      success: true,
      message: 'Renovação realizada com sucesso',
      data: {
        cliente: clienteAtualizado,
        renovacao: renovacaoRegistrada,
        plano_nome: obterNomePlano(plano_novo),
        novo_vencimento: novoVencimento,
        novo_vencimento_formatado: formatarData(novoVencimento)
      }
    });
  } catch (error) {
    console.error('❌ Erro ao executar renovação:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/renovacoes/estatisticas/resumo
 * Retorna estatísticas de renovações
 */
router.get('/estatisticas/resumo', async (req, res) => {
  try {
    const renovacoes = await renovacoesModel.getAll();
    
    // Calcular estatísticas
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    
    const renovacoesMes = renovacoes.filter(r => 
      new Date(r.data_renovacao) >= inicioMes
    );
    
    const totalValorMes = renovacoesMes.reduce((acc, r) => 
      acc + (parseFloat(r.valor_renovacao) || 0), 0
    );
    
    const totalValor = renovacoes.reduce((acc, r) => 
      acc + (parseFloat(r.valor_renovacao) || 0), 0
    );
    
    // Contagem por plano
    const contagemPorPlano = {};
    renovacoes.forEach(r => {
      const plano = obterNomePlano(r.plano_novo);
      contagemPorPlano[plano] = (contagemPorPlano[plano] || 0) + 1;
    });
    
    res.json({
      success: true,
      data: {
        total_renovacoes: renovacoes.length,
        renovacoes_mes_atual: renovacoesMes.length,
        valor_total_mes: totalValorMes,
        valor_total: totalValor,
        contagem_por_plano: contagemPorPlano
      }
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
