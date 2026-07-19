const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backend = fs.readFileSync(path.join(__dirname, '..', 'Código.gs'), 'utf8');

test('caixa recebe classificação sem reordenar colunas existentes', () => {
  assert.match(backend, /caixa:\s*\[[\s\S]{0,500}'deletadoEm',[\s\n]*'dreCategoria'/);
  assert.match(backend, /dre_mapeamento:\s*\[/);
  assert.match(backend, /const SHEETS_SCHEMA_VERSION = '4'/);
});

test('backend expõe somente rotas autenticadas de classificação DRE', () => {
  for (const action of ['getDreMapeamentos','saveDreClassificacao','saveDreMapeamento']) {
    assert.match(backend, new RegExp("case '" + action + "':"));
  }
  assert.doesNotMatch(backend, /if \(a === 'getDreMapeamentos'\) return/);
});

test('reclassificação escreve categoria e atualização, não valor ou data', () => {
  const match = backend.match(/function salvarClassificacaoDre_\([\s\S]*?\n\}/);
  assert.ok(match, 'função salvarClassificacaoDre_ ausente');
  assert.match(match[0], /SCHEMAS\.caixa\.indexOf\('dreCategoria'\)/);
  assert.match(match[0], /SCHEMAS\.caixa\.indexOf\('atualizadoEm'\)/);
  assert.doesNotMatch(match[0], /indexOf\('valor'\)|indexOf\('data'\)/);
});

test('mapeamento aceita somente categoria conhecida e pode ser desativado', () => {
  assert.match(backend, /function validarCategoriaDre_\(/);
  assert.match(backend, /function salvarMapeamentoDre_\(/);
  assert.match(backend, /normalizeBoolStr\(data\.ativo, 'true'\)/);
});
