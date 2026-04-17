#!/bin/bash

# Script para enviar o backend para o GitHub
# Execute este script na pasta do projeto

echo "🚀 Iniciando deploy para GitHub..."
echo ""

# Configurações
REPO_URL="https://github.com/JeffiBR/ThunderPlay.git"
BRANCH="main"

# Verifica se já é um repositório git
if [ ! -d ".git" ]; then
    echo "📁 Inicializando repositório Git..."
    git init
    git branch -M $BRANCH
    git remote add origin $REPO_URL
else
    echo "✅ Repositório Git já inicializado"
fi

# Adiciona todos os arquivos
echo ""
echo "📦 Adicionando arquivos..."
git add .

# Verifica o status
echo ""
echo "📋 Status dos arquivos:"
git status

# Commit
echo ""
echo "💾 Criando commit..."
git commit -m "Update: Backend IPTV com servidores e UI melhorada"

# Push
echo ""
echo "🚀 Enviando para GitHub..."
git push -u origin $BRANCH --force

echo ""
echo "✅ Deploy concluído!"
echo ""
echo "🔗 Acesse o Render para verificar o deploy:"
echo "   https://dashboard.render.com"
echo ""
