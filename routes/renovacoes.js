/**
 * Rotas de Renovações - paths ajustados
 */

const express = require('express');
const router = express.Router();
const { renovacoesModel, clientesModel, storage } = require('../githubStorage');

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
  if (novaData < hoje) novaData = new Date();
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

router.get('/', async (req, res) => {
  try {
    const renovacoes = await renovacoesModel.getAll();
    renovacoes.sort((a, b) => new Date(b.data_renovacao) - new Date(a.data_renovacao));
    res.json({ success: true, count: renovacoes.length, data: renovacoes });
  } catch (error) {
    console.error('Erro ao buscar renovações:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function getAnoMesFromISO(dataIso) {
  if (!dataIso || typeof dataIso !== 'string') return null;
  return dataIso.slice(0, 7);
}

function validarAnoMes(anoMes) {
  return typeof anoMes === 'string' && /^\d{4}-\d{2}$/.test(anoMes);
}

router.get('/historico/meses', async (req, res) => {
  try {
    const renovacoes = await renovacoesModel.getAll();
    const meses = Array.from(new Set(
      renovacoes.map(r => getAnoMesFromISO(r.data_renovacao)).filter(Boolean)
    )).sort().reverse();

    res.json({ success: true, count: meses.length, data: meses });
  } catch (error) {
    console.error('Erro ao buscar meses de histórico:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/historico/:anoMes', async (req, res) => {
  try {
    const { anoMes } = req.params;
    if (!validarAnoMes(anoMes)) {
      return res.status(400).json({ success: false, error: 'Parâmetro anoMes inválido (use YYYY-MM)' });
    }

    const [renovacoes, clientes] = await Promise.all([
      renovacoesModel.getAll(),
      clientesModel.getAll()
    ]);

    const renovacoesMes = renovacoes.filter(r => getAnoMesFromISO(r.data_renovacao) === anoMes);

    const renovacaoPorCliente = new Map();
    for (const r of renovacoesMes) {
      const key = r.cliente_id ? `id:${r.cliente_id}` : `nome:${r.cliente_nome || ''}`;
      const existente = renovacaoPorCliente.get(key);
      if (!existente || new Date(r.data_renovacao) > new Date(existente.data_renovacao)) {
        renovacaoPorCliente.set(key, r);
      }
    }

    const clientesPorId = new Map(clientes.map(c => [String(c.id), c]));
    const clientesRenovaram = Array.from(renovacaoPorCliente.values()).map(r => {
      const cliente = r.cliente_id ? clientesPorId.get(String(r.cliente_id)) : null;
      return {
        cliente_id: r.cliente_id || (cliente && cliente.id) || null,
        cliente_nome: r.cliente_nome || (cliente && cliente.nome) || '-',
        cliente_telefone: r.cliente_telefone || (cliente && cliente.telefone) || '-',
        revendedor: r.revendedor || (cliente && cliente.revendedor) || null,
        servidor: r.servidor || (cliente && cliente.servidor) || null,
        data_renovacao: r.data_renovacao,
        plano_novo: r.plano_novo,
        valor_renovacao: r.valor_renovacao,
        data_vencimento_novo: r.data_vencimento_novo
      };
    });

    const renovaramKeys = new Set(
      clientesRenovaram.map(c => c.cliente_id ? `id:${c.cliente_id}` : `nome:${c.cliente_nome}`)
    );

    const clientesNaoRenovaram = clientes.filter(c => {
      const key = c.id ? `id:${c.id}` : `nome:${c.nome}`;
      return !renovaramKeys.has(key);
    }).map(c => ({
      cliente_id: c.id || null,
      cliente_nome: c.nome || '-',
      cliente_telefone: c.telefone || '-',
      revendedor: c.revendedor || null,
      servidor: c.servidor || null,
      data_vencimento: c.data_vencimento || null
    }));

    const valorTotalMes = renovacoesMes.reduce((acc, r) => acc + (parseFloat(r.valor_renovacao) || 0), 0);

    res.json({
      success: true,
      data: {
        mes: anoMes,
        renovacoes_mes: renovacoesMes,
        clientes_renovaram: clientesRenovaram,
        clientes_nao_renovaram: clientesNaoRenovaram,
        total_renovacoes: renovacoesMes.length,
        total_clientes_renovaram: clientesRenovaram.length,
        total_clientes_nao_renovaram: clientesNaoRenovaram.length,
        valor_total_mes: valorTotalMes
      }
    });
  } catch (error) {
    console.error('Erro ao montar histórico:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/historico/:anoMes', async (req, res) => {
  try {
    const { anoMes } = req.params;
    if (!validarAnoMes(anoMes)) {
      return res.status(400).json({ success: false, error: 'Parâmetro anoMes inválido (use YYYY-MM)' });
    }

    const renovacoes = await renovacoesModel.getAll();
    const antes = renovacoes.length;
    const renovacoesFiltradas = renovacoes.filter(r => getAnoMesFromISO(r.data_renovacao) !== anoMes);
    const removidas = antes - renovacoesFiltradas.length;

    if (storage.isConfigured()) {
      const result = await storage.writeFile('data/renovacoes.json', renovacoesFiltradas, `Remover renovacoes do mes ${anoMes}`);
      if (!result.success) throw new Error(result.error || 'Falha ao salvar renovacoes apos remocao');
    }

    res.json({
      success: true,
      message: `Renovações removidas do mês ${anoMes}`,
      removidas
    });
  } catch (error) {
    console.error('Erro ao remover histórico:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const renovacoes = await renovacoesModel.getAll();
    const renovacao = renovacoes.find(r => r.id === parseInt(id));
    if (!renovacao) return res.status(404).json({ success: false, error: 'Renovação não encontrada' });
    res.json({ success: true, data: renovacao });
  } catch (error) {
    console.error('Erro ao buscar renovação:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/cliente/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;
    const renovacoes = await renovacoesModel.getByClienteId(clienteId);
    res.json({ success: true, count: renovacoes.length, data: renovacoes });
  } catch (error) {
    console.error('Erro ao buscar renovações do cliente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const renovacaoData = req.body;
    if (!renovacaoData.cliente_id) return res.status(400).json({ success: false, error: 'ID do cliente é obrigatório' });
    const cliente = await clientesModel.getById(renovacaoData.cliente_id);
    if (!cliente) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
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
    console.log('Renovação registrada:', renovacaoRegistrada.cliente_nome);
    res.status(201).json({ success: true, message: 'Renovação registrada com sucesso', data: renovacaoRegistrada });
  } catch (error) {
    console.error('Erro ao registrar renovação:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/executar', async (req, res) => {
  try {
    const { cliente_id, plano_novo, valor_renovacao } = req.body;
    if (!cliente_id || !plano_novo) return res.status(400).json({ success: false, error: 'ID do cliente e novo plano são obrigatórios' });
    const cliente = await clientesModel.getById(cliente_id);
    if (!cliente) return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    const novoVencimento = calcularNovoVencimento(cliente.data_vencimento, plano_novo);
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
    const dadosAtualizacao = { tipo_plano: plano_novo, valor_plano: valor_renovacao, data_vencimento: novoVencimento };
    const clienteAtualizado = await clientesModel.update(cliente_id, dadosAtualizacao);
    const renovacaoRegistrada = await renovacoesModel.create(dadosRenovacao);
    console.log('Renovação executada:', cliente.nome);
    console.log(`   Plano: ${obterNomePlano(plano_novo)}`);
    console.log(`   Novo vencimento: ${formatarData(novoVencimento)}`);
    res.json({ success: true, message: 'Renovação realizada com sucesso', data: { cliente: clienteAtualizado, renovacao: renovacaoRegistrada, plano_nome: obterNomePlano(plano_novo), novo_vencimento: novoVencimento, novo_vencimento_formatado: formatarData(novoVencimento) } });
  } catch (error) {
    console.error('Erro ao executar renovação:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/estatisticas/resumo', async (req, res) => {
  try {
    const renovacoes = await renovacoesModel.getAll();
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const renovacoesMes = renovacoes.filter(r => new Date(r.data_renovacao) >= inicioMes);
    const totalValorMes = renovacoesMes.reduce((acc, r) => acc + (parseFloat(r.valor_renovacao) || 0), 0);
    const totalValor = renovacoes.reduce((acc, r) => acc + (parseFloat(r.valor_renovacao) || 0), 0);
    const contagemPorPlano = {};
    renovacoes.forEach(r => { const plano = obterNomePlano(r.plano_novo); contagemPorPlano[plano] = (contagemPorPlano[plano] || 0) + 1; });
    res.json({ success: true, data: { total_renovacoes: renovacoes.length, renovacoes_mes_atual: renovacoesMes.length, valor_total_mes: totalValorMes, valor_total: totalValor, contagem_por_plano: contagemPorPlano } });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


