# Sonia Cabral Mega

Frontend estático do sistema do salão Sonia Cabral, publicado na Vercel e integrado ao backend em Google Apps Script.

## Estrutura

- `index.html`: aplicação principal
- `rules.js`: regras puras usadas pelo navegador
- `Código.gs` e `Regras.gs`: backend do Google Apps Script
- `vercel.json`: configuração de deploy e cabeçalhos de segurança
- `tests/`: testes automatizados e ambiente visual com dados fictícios

## Publicação segura

Sempre publique o backend antes do frontend. A nova interface depende das regras e rotas novas do Apps Script.

1. Rode `npm test` e confirme que todos os testes passaram.
2. No projeto Apps Script, envie `Código.gs`, `Regras.gs` e `appsscript.json`. Antes de enviar, `clasp status` deve listar os três arquivos.
3. Crie uma nova versão do Web App sem substituir ou apagar a versão anterior. Confirme que a ação pública de configuração responde e que a URL continua correta.
4. Só então publique o frontend na Vercel, com framework preset `Other`, build command vazio e output directory vazio.
5. Faça uma verificação curta: login, abertura da agenda, conclusão de um atendimento fictício controlado e conferência do lançamento no caixa.

Se a validação falhar, reverta primeiro a Vercel para o deploy anterior e depois selecione a versão anterior do Web App no Apps Script. Não apague as versões anteriores até a nova versão passar pela revisão operacional.

## Backend

A URL do backend Apps Script está configurada em `window.__API_URL__`, no `index.html`. Os arquivos `Código.gs` e `Regras.gs` devem estar no mesmo projeto Apps Script; publicar somente um deles deixa o backend incompleto.

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
