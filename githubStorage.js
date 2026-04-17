/**
 * GitHub Storage service
 * - Multi-tenant by user namespace: users/<user-id>/...
 * - Backup snapshot before write/delete: backup/<user-id>/YYYY-MM-DD/...
 */

const fetch = require('node-fetch');
const { AsyncLocalStorage } = require('async_hooks');

class GitHubStorage {
  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    this.owner = process.env.GITHUB_OWNER || 'JeffiBR';
    this.repo = process.env.GITHUB_REPO || 'Dados';
    this.branch = process.env.GITHUB_BRANCH || 'main';
    this.baseUrl = 'https://api.github.com';

    this.cache = new Map();
    this.cacheTimeout = 10000;

    this.asyncLocalStorage = new AsyncLocalStorage();
    this.backupEnabled = String(process.env.BACKUP_ENABLED || 'true').toLowerCase() !== 'false';
    this.backupFolderReadyUsers = new Set();
  }

  isConfigured() {
    return !!(this.token && this.owner && this.repo);
  }

  getHeaders() {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Preco-Certo-Backend'
    };
  }

  sanitizeUserId(value) {
    const raw = (value || process.env.DEFAULT_STORAGE_USER || 'public').toString().trim();
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'public';
  }

  getCurrentUserContext() {
    const fromAsync = this.asyncLocalStorage.getStore();
    if (fromAsync && fromAsync.userId && fromAsync.namespace) return fromAsync;

    const fallbackUser = this.sanitizeUserId(process.env.DEFAULT_STORAGE_USER || 'public');
    return {
      userId: fallbackUser,
      email: null,
      name: null,
      namespace: `users/${fallbackUser}`
    };
  }

  runWithRequestContext(req, next) {
    const userIdHeader = req.headers['x-user-id'] || req.headers['x-clerk-user-id'] || req.headers['x-user'];
    const emailHeader = req.headers['x-user-email'] || null;
    const nameHeader = req.headers['x-user-name'] || null;
    const userId = this.sanitizeUserId(userIdHeader || process.env.DEFAULT_STORAGE_USER || 'public');

    const ctx = {
      userId,
      email: emailHeader,
      name: nameHeader,
      namespace: `users/${userId}`
    };

    if (this.backupEnabled) {
      this.ensureUserBackupFolder(userId).catch((err) => {
        console.error(`Erro ao preparar pasta de backup para ${userId}:`, err.message || err);
      });
    }

    this.asyncLocalStorage.run(ctx, () => next());
  }

  normalizePath(path) {
    return String(path || '').replace(/^\/+/, '').replace(/\\/g, '/');
  }

  resolvePath(path, options = {}) {
    const normalized = this.normalizePath(path);
    if (options.skipNamespace) return normalized;
    if (normalized.startsWith('users/')) return normalized;

    const ctx = this.getCurrentUserContext();
    return `${ctx.namespace}/${normalized}`;
  }

  async _getContentMetaByResolvedPath(resolvedPath) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${resolvedPath}?ref=${this.branch}`;
    const response = await fetch(url, { method: 'GET', headers: this.getHeaders() });

    if (response.status === 404) return null;
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao ler metadata (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    let base64Content = null;

    if (data && data.content) {
      base64Content = String(data.content).replace(/\n/g, '');
    } else if (data && data.download_url) {
      const rawResponse = await fetch(data.download_url, { method: 'GET' });
      if (!rawResponse.ok) {
        const rawText = await rawResponse.text();
        throw new Error(`Erro ao baixar conteudo bruto (${rawResponse.status}): ${rawText}`);
      }
      const arr = await rawResponse.arrayBuffer();
      base64Content = Buffer.from(arr).toString('base64');
    }

    return {
      sha: data.sha,
      base64Content,
      path: data.path
    };
  }

  async _getFileShaByResolvedPath(resolvedPath) {
    try {
      const meta = await this._getContentMetaByResolvedPath(resolvedPath);
      return meta ? meta.sha : null;
    } catch (error) {
      console.error('Erro ao obter SHA:', error.message);
      return null;
    }
  }

  async getFileSha(path, options = {}) {
    const resolvedPath = this.resolvePath(path, options);
    return this._getFileShaByResolvedPath(resolvedPath);
  }

  async _writeBase64ByResolvedPath(resolvedPath, base64Content, message) {
    const sha = await this._getFileShaByResolvedPath(resolvedPath);
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${resolvedPath}`;

    const body = {
      message,
      content: base64Content,
      branch: this.branch
    };

    if (sha) body.sha = sha;

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao escrever arquivo (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    this.cache.delete(`read_${resolvedPath}`);
    return data;
  }

  _appendTimestampToFileName(path, timeTag) {
    const clean = this.normalizePath(path);
    const lastSlash = clean.lastIndexOf('/');
    const dir = lastSlash >= 0 ? clean.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
    const dot = fileName.lastIndexOf('.');
    const hasExt = dot > 0;
    const base = hasExt ? fileName.slice(0, dot) : fileName;
    const ext = hasExt ? fileName.slice(dot) : '.bak';
    const stamped = `${base}__${timeTag}${ext}`;
    return dir ? `${dir}/${stamped}` : stamped;
  }

  async ensureBackupRoot() {
    if (!this.backupEnabled) return;
    const sha = await this._getFileShaByResolvedPath('backup/.keep');
    if (sha) return;
    await this._writeBase64ByResolvedPath(
      'backup/.keep',
      Buffer.from(JSON.stringify({ created_at: new Date().toISOString() }, null, 2), 'utf-8').toString('base64'),
      'Inicializar pasta backup'
    );
  }

  async ensureUserBackupFolder(userId) {
    if (!this.backupEnabled) return;
    const safeUserId = this.sanitizeUserId(userId);
    if (this.backupFolderReadyUsers.has(safeUserId)) return;

    await this.ensureBackupRoot();

    const keepPath = `backup/${safeUserId}/.keep`;
    const sha = await this._getFileShaByResolvedPath(keepPath);
    if (!sha) {
      await this._writeBase64ByResolvedPath(
        keepPath,
        Buffer.from(JSON.stringify({ user_id: safeUserId, created_at: new Date().toISOString() }, null, 2), 'utf-8').toString('base64'),
        `Inicializar backup do usuario ${safeUserId}`
      );
    }

    this.backupFolderReadyUsers.add(safeUserId);
  }

  async createBackupSnapshot(path, options = {}) {
    if (!this.backupEnabled || options.skipBackup) return null;

    const normalizedOriginalPath = this.normalizePath(path);
    if (!normalizedOriginalPath) return null;
    if (normalizedOriginalPath.startsWith('backup/') || normalizedOriginalPath.startsWith('_backup/')) return null;

    const ctx = this.getCurrentUserContext();
    const safeUserId = this.sanitizeUserId(ctx.userId);
    await this.ensureUserBackupFolder(safeUserId);

    const resolvedOriginal = this.resolvePath(normalizedOriginalPath, options);
    const sourceMeta = await this._getContentMetaByResolvedPath(resolvedOriginal);
    const base64ForBackup = sourceMeta && sourceMeta.base64Content
      ? sourceMeta.base64Content
      : (options.fallbackBase64Content || null);

    if (!base64ForBackup) return null;

    const now = new Date();
    const dateTag = now.toISOString().slice(0, 10);
    const timeTag = now.toISOString().replace(/[:.]/g, '-');
    const stampedPath = this._appendTimestampToFileName(normalizedOriginalPath, timeTag);
    const backupPath = `backup/${safeUserId}/${dateTag}/${stampedPath}`;

    await this._writeBase64ByResolvedPath(
      backupPath,
      base64ForBackup,
      `Backup de seguranca: ${normalizedOriginalPath}`
    );

    console.log(`Backup criado: ${backupPath}`);
    return backupPath;
  }
  async readFile(path, options = {}) {
    const resolvedPath = this.resolvePath(path, options);
    const cacheKey = `read_${resolvedPath}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const meta = await this._getContentMetaByResolvedPath(resolvedPath);
      if (!meta || !meta.base64Content) return null;

      const contentText = Buffer.from(meta.base64Content, 'base64').toString('utf-8');
      const json = JSON.parse(contentText || 'null');

      this.cache.set(cacheKey, { data: json, timestamp: Date.now() });
      return json;
    } catch (error) {
      console.error('Erro ao ler arquivo:', error.message);
      return null;
    }
  }

  async writeFile(path, content, message = 'Atualizacao via API', options = {}) {
    const resolvedPath = this.resolvePath(path, options);

    try {
      const payloadBase64 = Buffer.from(JSON.stringify(content, null, 2), 'utf-8').toString('base64');
      await this.createBackupSnapshot(path, { ...options, fallbackBase64Content: payloadBase64 });
      await this._writeBase64ByResolvedPath(
        resolvedPath,
        payloadBase64,
        message
      );

      return { success: true };
    } catch (error) {
      console.error('Erro ao escrever arquivo:', error.message);
      return { success: false, error: error.message };
    }
  }

  async writeBinaryFile(path, base64Content, message = 'Upload binario via API', options = {}) {
    const resolvedPath = this.resolvePath(path, options);

    try {
      await this.createBackupSnapshot(path, { ...options, fallbackBase64Content: base64Content });
      const data = await this._writeBase64ByResolvedPath(resolvedPath, base64Content, message);

      return {
        success: true,
        sha: data.content.sha,
        url: data.content.html_url,
        download_url: data.content.download_url,
        path: data.content.path
      };
    } catch (error) {
      console.error('Erro ao escrever binario:', error.message);
      return { success: false, error: error.message };
    }
  }

  async deleteFile(path, message = 'Delecao via API', options = {}) {
    const resolvedPath = this.resolvePath(path, options);

    try {
      await this.createBackupSnapshot(path, options);
      const sha = await this._getFileShaByResolvedPath(resolvedPath);
      if (!sha) return { success: false, error: 'Arquivo nao encontrado' };

      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${resolvedPath}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(),
        body: JSON.stringify({
          message,
          sha,
          branch: this.branch
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao deletar arquivo (${response.status}): ${errorText}`);
      }

      this.cache.delete(`read_${resolvedPath}`);
      return { success: true };
    } catch (error) {
      console.error('Erro ao deletar arquivo:', error.message);
      return { success: false, error: error.message };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

class ClientesModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'data/clientes.json';
  }

  async getAll() {
    if (!this.storage.isConfigured()) return this.getMockData();
    const data = await this.storage.readFile(this.filePath);
    return data || [];
  }

  async getById(id) {
    const clientes = await this.getAll();
    return clientes.find((c) => c.id === id || c.id === parseInt(id, 10));
  }

  async create(cliente) {
    const clientes = await this.getAll();
    const maxId = clientes.length > 0 ? Math.max(...clientes.map((c) => parseInt(c.id, 10) || 0)) : 0;
    cliente.id = maxId + 1;
    cliente.created_at = new Date().toISOString();
    cliente.updated_at = new Date().toISOString();
    clientes.push(cliente);

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(this.filePath, clientes, `Adicionar cliente: ${cliente.nome || cliente.id}`);
      if (!result.success) throw new Error(result.error || 'Falha ao salvar cliente');
    }
    return cliente;
  }

  async update(id, updates) {
    const clientes = await this.getAll();
    const index = clientes.findIndex((c) => c.id === id || c.id === parseInt(id, 10));
    if (index === -1) return null;

    clientes[index] = { ...clientes[index], ...updates, updated_at: new Date().toISOString() };
    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(this.filePath, clientes, `Atualizar cliente: ${clientes[index].nome || id}`);
      if (!result.success) throw new Error(result.error || 'Falha ao atualizar cliente');
    }
    return clientes[index];
  }

  async delete(id) {
    const clientes = await this.getAll();
    const index = clientes.findIndex((c) => c.id === id || c.id === parseInt(id, 10));
    if (index === -1) return false;

    const removed = clientes.splice(index, 1)[0];
    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(this.filePath, clientes, `Remover cliente: ${removed.nome || id}`);
      if (!result.success) throw new Error(result.error || 'Falha ao remover cliente');
    }
    return true;
  }

  getMockData() {
    return [];
  }
}

class RenovacoesModel {
  constructor(storage) {
    this.storage = storage;
    this.filePath = 'data/renovacoes.json';
  }

  async getAll() {
    if (!this.storage.isConfigured()) return [];
    const data = await this.storage.readFile(this.filePath);
    return data || [];
  }

  async create(renovacao) {
    const renovacoes = await this.getAll();
    const maxId = renovacoes.length > 0 ? Math.max(...renovacoes.map((r) => parseInt(r.id, 10) || 0)) : 0;
    renovacao.id = maxId + 1;
    renovacao.data_renovacao = new Date().toISOString();
    renovacoes.push(renovacao);

    if (this.storage.isConfigured()) {
      const result = await this.storage.writeFile(this.filePath, renovacoes, `Registrar renovacao: ${renovacao.cliente_nome || renovacao.id}`);
      if (!result.success) throw new Error(result.error || 'Falha ao registrar renovacao');
    }
    return renovacao;
  }

  async getByClienteId(clienteId) {
    const renovacoes = await this.getAll();
    return renovacoes.filter((r) => r.cliente_id === clienteId || r.cliente_id === parseInt(clienteId, 10));
  }
}

const storage = new GitHubStorage();
const clientesModel = new ClientesModel(storage);
const renovacoesModel = new RenovacoesModel(storage);

module.exports = {
  GitHubStorage,
  ClientesModel,
  RenovacoesModel,
  storage,
  clientesModel,
  renovacoesModel
};

