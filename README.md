# Sonia Cabral Mega

Frontend estático do sistema do salão Sonia Cabral, publicado na Vercel e integrado ao backend em Google Apps Script.

## Estrutura
- `index.html`: aplicação principal
- `vercel.json`: configuração de deploy da Vercel

## Deploy
1. Subir os arquivos para a branch principal no GitHub
2. Importar o repositório na Vercel
3. Framework preset: `Other`
4. Build command: vazio
5. Output directory: vazio

## Backend
A URL do backend Apps Script está configurada diretamente no `index.html`.

## Observações
Caso a URL do Web App do Apps Script mude, basta atualizar a constante:

```js
window.__API_URL__
