# Sonia Cabral Mega

Frontend estático do sistema do salão Sonia Cabral, publicado na Vercel e integrado ao backend em Google Apps Script.

## Estrutura

- `index.html`: aplicação principal
- `rules.js`: regras puras usadas pelo navegador
- `Código.gs` e `Regras.gs`: backend do Google Apps Script
- `vercel.json`: configuração de deploy e cabeçalhos de segurança
- `tests/`: testes automatizados e ambiente visual com dados fictícios

## Deploy
1. Subir os arquivos para a branch principal no GitHub
2. Importar o repositório na Vercel
3. Framework preset: `Other`
4. Build command: vazio
5. Output directory: vazio

## Backend

A URL do backend Apps Script está configurada em `window.__API_URL__`, no `index.html`. Ao publicar o backend, envie `Código.gs` e `Regras.gs` para o mesmo projeto Apps Script.

Em instalações existentes, a senha em texto puro é migrada automaticamente para hash com salt no primeiro login válido. Em uma instalação nova, execute uma vez pelo editor do Apps Script:

```js
definirSenhaInicial('uma senha segura com 8 ou mais caracteres')
```

Depois dessa inicialização, a senha só deve ser alterada pela tela de configurações do sistema.

## Verificação local

```powershell
npm test
npm run preview:fixture
```

O segundo comando abre um servidor local com dados fictícios. Ele não acessa a planilha nem o backend real.

## Observações
Caso a URL do Web App do Apps Script mude, basta atualizar a constante:

```js
window.__API_URL__
```
