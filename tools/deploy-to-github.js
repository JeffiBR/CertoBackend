/**
 * Script para enviar o backend para o GitHub
 * Execute: node deploy-to-github.js
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Configurações
const TOKEN = process.env.GITHUB_TOKEN || '';
const OWNER = 'JeffiBR';
const REPO = 'ThunderPlay';
const BRANCH = 'main';
const BASE_URL = 'https://api.github.com';

// Headers para a API do GitHub
const headers = {
  'Authorization': `token ${TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'Content-Type': 'application/json',
  'User-Agent': 'ThunderPlay-Deploy'
};

// Lista de arquivos para enviar
const filesToUpload = [
  { local: '../server.js', remote: 'server.js' },
  { local: '../package.json', remote: 'package.json' },
  { local: '../render.yaml', remote: 'render.yaml' },
  { local: '../routes/clientes.js', remote: 'routes/clientes.js' },
  { local: '../routes/renovacoes.js', remote: 'routes/renovacoes.js' },
  { local: '../routes/servidores.js', remote: 'routes/servidores.js' }
];

// Arquivos de dados iniciais
const dataFiles = [
  { remote: 'data/clientes.json', content: [] },
  { remote: 'data/renovacoes.json', content: [] },
  { remote: 'data/servidores.json', content: [] }
];

/**
 * Obtém o SHA de um arquivo existente
 */
async function getFileSha(filePath) {
  const url = `${BASE_URL}/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`;
  
  try {
    const response = await fetch(url, { method: 'GET', headers });
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`Erro ao obter SHA de ${filePath}:`, response.status, text);
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    console.error(`Erro ao obter SHA de ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Envia um arquivo para o GitHub
 */
async function uploadFile(localPath, remotePath, isJson = true) {
  const fullPath = path.join(__dirname, localPath);
  
  // Ler arquivo local
  let content;
  if (fs.existsSync(fullPath)) {
    content = fs.readFileSync(fullPath, 'utf-8');
  } else if (isJson) {
    // Arquivo de dados - criar vazio
    content = '[]';
  } else {
    console.log(`⚠️ Arquivo não encontrado: ${localPath}`);
    return false;
  }
  
  // Codificar para base64
  const base64Content = Buffer.from(content).toString('base64');
  
  // Obter SHA se arquivo já existe
  const sha = await getFileSha(remotePath);
  
  // Preparar body
  const body = {
    message: sha 
      ? `Update: ${remotePath}` 
      : `Create: ${remotePath}`,
    content: base64Content,
    branch: BRANCH
  };
  
  if (sha) {
    body.sha = sha;
  }
  
  // Enviar para GitHub
  const url = `${BASE_URL}/repos/${OWNER}/${REPO}/contents/${remotePath}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Erro ao enviar ${remotePath}:`, response.status, text);
      return false;
    }
    
    console.log(`✅ Enviado: ${remotePath}`);
    return true;
  } catch (error) {
    console.error(`❌ Erro ao enviar ${remotePath}:`, error.message);
    return false;
  }
}

/**
 * Envia arquivo de dados JSON
 */
async function uploadDataFile(remotePath, content) {
  const contentStr = JSON.stringify(content, null, 2);
  const base64Content = Buffer.from(contentStr).toString('base64');
  
  const sha = await getFileSha(remotePath);
  
  const body = {
    message: sha 
      ? `Update: ${remotePath}` 
      : `Create: ${remotePath}`,
    content: base64Content,
    branch: BRANCH
  };
  
  if (sha) {
    body.sha = sha;
  }
  
  const url = `${BASE_URL}/repos/${OWNER}/${REPO}/contents/${remotePath}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Erro ao enviar ${remotePath}:`, response.status, text);
      return false;
    }
    
    console.log(`✅ Enviado: ${remotePath}`);
    return true;
  } catch (error) {
    console.error(`❌ Erro ao enviar ${remotePath}:`, error.message);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  if (!TOKEN) {
    throw new Error('Defina GITHUB_TOKEN no ambiente antes de executar este script.');
  }

  console.log('');
  console.log('🚀 Deploy ThunderPlay IPTV Backend para GitHub');
  console.log('='.repeat(50));
  console.log(`📦 Repositório: ${OWNER}/${REPO}`);
  console.log(`🌿 Branch: ${BRANCH}`);
  console.log('');
  
  // Enviar arquivos do backend
  console.log('📁 Enviando arquivos do backend...');
  console.log('');
  
  for (const file of filesToUpload) {
    await uploadFile(file.local, file.remote, false);
    // Pequena pausa para não exceder rate limit
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Enviar arquivos de dados
  console.log('');
  console.log('📁 Criando arquivos de dados...');
  console.log('');
  
  for (const file of dataFiles) {
    await uploadDataFile(file.remote, file.content);
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('');
  console.log('='.repeat(50));
  console.log('✅ Deploy concluído!');
  console.log('');
  console.log('🔗 Próximos passos:');
  console.log('   1. Acesse https://dashboard.render.com');
  console.log('   2. Crie um novo Web Service conectando o repositório');
  console.log('   3. Configure as variáveis de ambiente:');
  console.log('      - GITHUB_TOKEN (seu token)');
  console.log('      - GITHUB_OWNER: JeffiBR');
  console.log('      - GITHUB_REPO: ThunderPlay');
  console.log('');
  console.log(`🌐 Repositório: https://github.com/${OWNER}/${REPO}`);
  console.log('');
}

main().catch(console.error);
