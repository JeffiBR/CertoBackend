/**
 * Modelo de Servidores
 */

class ServidoresModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'data/servidores.json';
  }

  async getAll() {
    if (!this.storage.isConfigured()) {
      console.warn('âš ï¸ GitHub Storage nÃ£o configurado, retornando servidores padrÃ£o');
      return this.getDefaultData();
    }

    const data = await this.storage.readFile(this.filePath);
    return data || this.getDefaultData();
  }

  async getById(id) {
    const servidores = await this.getAll();
    return servidores.find(s => s.id === id || s.id === parseInt(id));
  }

  async create(servidor) {
    const servidores = await this.getAll();
    
    // Gerar ID Ãºnico
    const maxId = servidores.length > 0 
      ? Math.max(...servidores.map(s => parseInt(s.id) || 0)) 
      : 0;
    
    servidor.id = maxId + 1;
    servidor.created_at = new Date().toISOString();
    servidor.updated_at = new Date().toISOString();
    
    servidores.push(servidor);
    
    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath, 
        servidores, 
        `Adicionar servidor: ${servidor.nome}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }
    
    return servidor;
  }

  async update(id, updates) {
    const servidores = await this.getAll();
    const index = servidores.findIndex(s => s.id === id || s.id === parseInt(id));
    
    if (index === -1) {
      return null;
    }
    
    servidores[index] = {
      ...servidores[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    
    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath, 
        servidores, 
        `Atualizar servidor: ${servidores[index].nome}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }
    
    return servidores[index];
  }

  async delete(id) {
    const servidores = await this.getAll();
    const index = servidores.findIndex(s => s.id === id || s.id === parseInt(id));
    
    if (index === -1) {
      return false;
    }
    
    const servidorRemovido = servidores.splice(index, 1)[0];
    
    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(
        this.filePath, 
        servidores, 
        `Remover servidor: ${servidorRemovido.nome}`
      );
    if (!result.success) throw new Error(result.error || 'Falha ao salvar dados no GitHub');
    }
    
    return true;
  }

  getDefaultData() {
    return [
      {
        id: 1,
        nome: 'UltraPlay',
        url: 'https://ultraplay.com',
        descricao: 'Servidor principal UltraPlay',
        status: 'ativo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 2,
        nome: '4K Player Pro',
        url: 'https://4kplayerpro.com',
        descricao: 'Servidor 4K Player Pro',
        status: 'ativo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 3,
        nome: 'Blaze',
        url: 'https://blaze.com',
        descricao: 'Servidor Blaze',
        status: 'ativo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];
  }
}

module.exports = { ServidoresModel };


