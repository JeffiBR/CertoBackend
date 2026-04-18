/**
 * Modelo de Recargas de Celular (compartilhado entre usuarios)
 */

class RecargasCelularModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'Atelie/recargas_celular.json';
  }

  async getAll() {
    if (!this.storage.isConfigured()) return [];
    const data = await this.storage.readFile(this.filePath, { skipNamespace: true, skipBackup: true });
    return Array.isArray(data) ? data : [];
  }

  async saveAll(items, message) {
    if (!this.storage.isConfigured()) throw new Error('GitHub Storage nao configurado');
    const result = await this.storage.writeFile(
      this.filePath,
      Array.isArray(items) ? items : [],
      message || 'Atualizar recargas celular',
      { skipNamespace: true, skipBackup: false }
    );
    if (!result || !result.success) throw new Error(result && result.error ? result.error : 'Falha ao salvar recargas');
  }

  async getById(id) {
    const items = await this.getAll();
    return items.find((r) => String(r.id) === String(id)) || null;
  }

  async create(payload) {
    const items = await this.getAll();
    const maxId = items.reduce((acc, item) => Math.max(acc, Number(item && item.id ? item.id : 0)), 0);
    const now = new Date().toISOString();
    const recarga = {
      id: maxId + 1,
      user_id: String(payload.user_id || '').trim(),
      cliente_nome: String(payload.cliente_nome || '').trim(),
      numero: String(payload.numero || '').trim(),
      operadora: String(payload.operadora || '').trim(),
      valor: Number(payload.valor || 0),
      valor_credito: Number(payload.valor_credito || 0),
      valor_pago: Number(payload.valor_pago || payload.valor || 0),
      status: String(payload.status || 'em_processo'),
      comentario_cliente: String(payload.comentario_cliente || '').trim(),
      comentario_desenvolvedor: String(payload.comentario_desenvolvedor || '').trim(),
      created_at: now,
      updated_at: now
    };
    items.unshift(recarga);
    await this.saveAll(items, `Criar recarga celular #${recarga.id}`);
    return recarga;
  }

  async update(id, updates) {
    const items = await this.getAll();
    const index = items.findIndex((r) => String(r.id) === String(id));
    if (index < 0) return null;
    items[index] = {
      ...items[index],
      ...updates,
      id: items[index].id,
      updated_at: new Date().toISOString()
    };
    await this.saveAll(items, `Atualizar recarga celular #${items[index].id}`);
    return items[index];
  }
}

module.exports = { RecargasCelularModel };
