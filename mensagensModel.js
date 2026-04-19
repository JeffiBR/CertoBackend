/**
 * Modelo de Mensagens de Cobrança
 */

class MensagensModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'data/mensagens_cobranca.json';
  }

  getDefaultData() {
    return [
      {
        id: 'd-3',
        nome: 'Cobrança 3 dias antes',
        regra: 'D-3',
        texto: 'Olá {nome}, sua assinatura vence em {vencimento} (faltam {dias} dias). Valor: {valor}. Servidor: {servidor}. Qualquer dúvida, fale com {revendedor}.'
      },
      {
        id: 'd-2',
        nome: 'Cobrança 2 dias antes',
        regra: 'D-2',
        texto: 'Olá {nome}, faltam {dias} dias para o vencimento ({vencimento}). Valor: {valor}. Servidor: {servidor}.'
      },
      {
        id: 'd-1',
        nome: 'Cobrança 1 dia antes',
        regra: 'D-1',
        texto: 'Olá {nome}, sua assinatura vence amanhã ({vencimento}). Valor: {valor}. Servidor: {servidor}.'
      },
      {
        id: 'd0',
        nome: 'Cobrança no dia',
        regra: 'D0',
        texto: 'Olá {nome}, hoje ({vencimento}) é o vencimento da sua assinatura. Valor: {valor}. Servidor: {servidor}. Caso já tenha pago, desconsidere.'
      },
      {
        id: 'd+1',
        nome: 'Cobrança após vencimento',
        regra: 'D+1',
        texto: 'Olá {nome}, sua assinatura venceu em {vencimento} (há {dias} dia). Valor: {valor}. Servidor: {servidor}. Podemos renovar?'
      }
    ];
  }

  async getAll() {
    if (!this.storage.isConfigured()) {
      console.warn('GitHub Storage não configurado, retornando mensagens padrão');
      return this.getDefaultData();
    }

    const data = await this.storage.readFile(this.filePath);
    const defaults = this.getDefaultData();
    if (!Array.isArray(data) || data.length === 0) {
      return defaults;
    }

    const byId = new Map(data.map(item => [item.id, item]));
    const merged = [...data];
    defaults.forEach(def => {
      if (!byId.has(def.id)) {
        merged.push(def);
      }
    });

    return merged;
  }

  async saveAll(mensagens) {
    if (!this.storage.isConfigured()) {
      return { success: false, error: 'GitHub Storage não configurado' };
    }
    const result = await this.storage.writeFile(this.filePath, mensagens, 'Atualizar mensagens de cobrança');
    if (!result.success) return { success: false, error: result.error || 'Falha ao salvar mensagens' };
    return { success: true };
  }

  async updateById(id, updates) {
    const mensagens = await this.getAll();
    const index = mensagens.findIndex(m => m.id === id);
    if (index === -1) return null;

    mensagens[index] = {
      ...mensagens[index],
      ...updates,
      updated_at: new Date().toISOString()
    };

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(this.filePath, mensagens, `Atualizar mensagem: ${mensagens[index].nome}`);
      if (!result.success) throw new Error(result.error || 'Falha ao atualizar mensagem');
    }

    return mensagens[index];
  }
}

module.exports = { MensagensModel };



