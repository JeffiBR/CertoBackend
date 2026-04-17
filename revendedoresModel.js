/**
 * Modelo de Revendedores
 */

class RevendedoresModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'data/revendedores.json';
  }

  async getAll() {
    if (!this.storage.isConfigured()) {
      console.warn('âš ï¸ GitHub Storage nÃ£o configurado, retornando revendedores padrÃ£o');
      return this.getDefaultData();
    }

    const data = await this.storage.readFile(this.filePath);
    return data || this.getDefaultData();
  }

  async getById(id) {
    const revendedores = await this.getAll();
    return revendedores.find(r => r.id === id || r.id === parseInt(id));
  }

  async create(revendedor) {
    const revendedores = await this.getAll();

    const maxId = revendedores.length > 0
      ? Math.max(...revendedores.map(r => parseInt(r.id) || 0))
      : 0;

    revendedor.id = maxId + 1;
    revendedor.created_at = new Date().toISOString();
    revendedor.updated_at = new Date().toISOString();

    revendedores.push(revendedor);

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath,
        revendedores,
        `Adicionar revendedor: ${revendedor.nome}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }

    return revendedor;
  }

  async update(id, updates) {
    const revendedores = await this.getAll();
    const index = revendedores.findIndex(r => r.id === id || r.id === parseInt(id));

    if (index === -1) {
      return null;
    }

    revendedores[index] = {
      ...revendedores[index],
      ...updates,
      updated_at: new Date().toISOString()
    };

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath,
        revendedores,
        `Atualizar revendedor: ${revendedores[index].nome}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }

    return revendedores[index];
  }

  async delete(id) {
    const revendedores = await this.getAll();
    const index = revendedores.findIndex(r => r.id === id || r.id === parseInt(id));

    if (index === -1) {
      return false;
    }

    const revendedorRemovido = revendedores.splice(index, 1)[0];

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath,
        revendedores,
        `Remover revendedor: ${revendedorRemovido.nome}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }

    return true;
  }

  getDefaultData() {
    return [
      {
        id: 1,
        nome: 'Leandro',
        telefone: '55-8199990000',
        email: 'leandro@revenda.com',
        comissao: 20,
        status: 'ativo',
        observacoes: 'Revenda principal',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 2,
        nome: 'Camila',
        telefone: '55-8198888777',
        email: 'camila@revenda.com',
        comissao: 15,
        status: 'ativo',
        observacoes: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];
  }
}

module.exports = { RevendedoresModel };


