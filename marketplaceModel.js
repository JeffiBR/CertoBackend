/**
 * Modelo de Marketplace
 * - Produtos cadastrados pelo desenvolvedor
 * - Pedidos criados pelos usuarios no checkout PIX
 */

class MarketplaceModel {
  constructor(storage) {
    this.storage = storage;
    this.productsFilePath = 'Atelie/marketplace_products.json';
    this.ordersFilePath = 'Atelie/marketplace_orders.json';
    this.categoriesFilePath = 'Atelie/marketplace_categories.json';
  }

  async readArray(filePath) {
    if (!this.storage.isConfigured()) return [];
    const data = await this.storage.readFile(filePath, { skipNamespace: true, skipBackup: true });
    return Array.isArray(data) ? data : [];
  }

  async writeArray(filePath, payload, message) {
    if (!this.storage.isConfigured()) throw new Error('GitHub Storage não configurado');
    const result = await this.storage.writeFile(
      filePath,
      Array.isArray(payload) ? payload : [],
      message,
      { skipNamespace: true, skipBackup: false }
    );
    if (!result || !result.success) {
      throw new Error(result && result.error ? result.error : 'Falha ao salvar marketplace');
    }
  }

  async getProducts() {
    return this.readArray(this.productsFilePath);
  }

  async saveProducts(items, message) {
    await this.writeArray(this.productsFilePath, items, message || 'Atualizar produtos do marketplace');
  }

  async getProductById(id) {
    const items = await this.getProducts();
    return items.find((p) => String(p.id) === String(id)) || null;
  }

  async createProduct(payload) {
    const items = await this.getProducts();
    const maxId = items.reduce((acc, item) => Math.max(acc, Number(item && item.id ? item.id : 0)), 0);
    const now = new Date().toISOString();
    const product = {
      id: maxId + 1,
      nome: String(payload.nome || '').trim(),
      descricao: String(payload.descricao || '').trim(),
      imagem_url: String(payload.imagem_url || '').trim(),
      valor: Number(payload.valor || 0),
      ativo: payload.ativo !== false,
      created_at: now,
      updated_at: now
    };
    items.unshift(product);
    await this.saveProducts(items, `Criar produto marketplace #${product.id}`);
    return product;
  }

  async updateProduct(id, updates) {
    const items = await this.getProducts();
    const index = items.findIndex((p) => String(p.id) === String(id));
    if (index < 0) return null;
    items[index] = {
      ...items[index],
      ...updates,
      id: items[index].id,
      updated_at: new Date().toISOString()
    };
    await this.saveProducts(items, `Atualizar produto marketplace #${items[index].id}`);
    return items[index];
  }

  async deleteProduct(id) {
    const items = await this.getProducts();
    const index = items.findIndex((p) => String(p.id) === String(id));
    if (index < 0) return null;
    const removed = items[index];
    items.splice(index, 1);
    await this.saveProducts(items, `Excluir produto marketplace #${removed.id}`);
    return removed;
  }

  async getOrders() {
    return this.readArray(this.ordersFilePath);
  }

  async saveOrders(items, message) {
    await this.writeArray(this.ordersFilePath, items, message || 'Atualizar pedidos do marketplace');
  }

  async createOrder(payload) {
    const items = await this.getOrders();
    const maxId = items.reduce((acc, item) => Math.max(acc, Number(item && item.id ? item.id : 0)), 0);
    const now = new Date().toISOString();
    const order = {
      id: maxId + 1,
      user_id: String(payload.user_id || '').trim(),
      cliente_nome: String(payload.cliente_nome || '').trim(),
      items: Array.isArray(payload.items) ? payload.items : [],
      subtotal: Number(payload.subtotal || 0),
      desconto: Number(payload.desconto || 0),
      total: Number(payload.total || 0),
      status: String(payload.status || 'aguardando_pagamento'),
      comentario_cliente: String(payload.comentario_cliente || '').trim(),
      comentario_desenvolvedor: String(payload.comentario_desenvolvedor || '').trim(),
      created_at: now,
      updated_at: now
    };
    items.unshift(order);
    await this.saveOrders(items, `Criar pedido marketplace #${order.id}`);
    return order;
  }

  async updateOrder(id, updates) {
    const items = await this.getOrders();
    const index = items.findIndex((o) => String(o.id) === String(id));
    if (index < 0) return null;
    items[index] = {
      ...items[index],
      ...updates,
      id: items[index].id,
      updated_at: new Date().toISOString()
    };
    await this.saveOrders(items, `Atualizar pedido marketplace #${items[index].id}`);
    return items[index];
  }

  async getCategories() {
    const items = await this.readArray(this.categoriesFilePath);
    const list = items
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return [...new Set(list)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async saveCategories(items, message) {
    const list = [...new Set((Array.isArray(items) ? items : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    await this.writeArray(this.categoriesFilePath, list, message || 'Atualizar categorias do marketplace');
    return list;
  }
}

module.exports = { MarketplaceModel };

