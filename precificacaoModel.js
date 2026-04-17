/**
 * Modelo de Precificacao (Atelie)
 */

class PrecificacaoModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'Atelie/precificacao.json';
  }

  async getAll() {
    if (!this.storage.isConfigured()) {
      return [];
    }

    const data = await this.storage.readFile(this.filePath);
    if (data === null) {
      throw new Error('Falha ao ler arquivo de precificacao no GitHub');
    }
    return data || [];
  }

  async getById(id) {
    const itens = await this.getAll();
    return itens.find(i => i.id === id || i.id === parseInt(id, 10));
  }

  async create(item) {
    const itens = await this.getAll();
    const maxId = itens.length > 0
      ? Math.max(...itens.map(i => parseInt(i.id, 10) || 0))
      : 0;

    const novoItem = {
      id: maxId + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...item
    };

    itens.push(novoItem);

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath,
        itens,
        `Adicionar precificaÃ§Ã£o: ${novoItem.nome_produto || 'ID ' + novoItem.id}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }

    return novoItem;
  }

  async update(id, updates) {
    const itens = await this.getAll();
    const index = itens.findIndex(i => i.id === id || i.id === parseInt(id, 10));

    if (index === -1) {
      return null;
    }

    itens[index] = {
      ...itens[index],
      ...updates,
      updated_at: new Date().toISOString()
    };

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath,
        itens,
        `Atualizar precificacao: ${itens[index].nome_produto || 'ID ' + id}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }

    return itens[index];
  }

  async delete(id) {
    const itens = await this.getAll();
    const index = itens.findIndex(i => i.id === id || i.id === parseInt(id, 10));

    if (index === -1) {
      return false;
    }

    const removido = itens.splice(index, 1)[0];

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath,
        itens,
        `Remover precificacao: ${removido.nome_produto || 'ID ' + id}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }

    return true;
  }
}

module.exports = { PrecificacaoModel };


