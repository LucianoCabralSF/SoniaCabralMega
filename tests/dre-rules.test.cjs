const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'DreRegras.gs'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context, { filename:'DreRegras.gs' });

const movements = [
  { id:'s1', data:'2026-01-10', tipo:'entrada', itemTipo:'agendamento', valor:1000 },
  { id:'p1', data:'2026-01-11', tipo:'entrada', itemTipo:'produto', valor:200 },
  { id:'a1', data:'2026-01-12', tipo:'saida', categoria:'Aluguel', valor:300 },
  { id:'r1', data:'2026-01-13', tipo:'saida', categoria:'Retirada Pessoal', isRetirada:'true', valor:100 },
  { id:'x1', data:'2026-01-14', tipo:'saida', categoria:'Outros', valor:50 },
  { id:'s2', data:'2026-02-10', tipo:'entrada', itemTipo:'agendamento', valor:500 }
];

test('classifica somente regras seguras', () => {
  assert.equal(context.classificarMovimentoDre_(movements[0], []), 'receita_servicos');
  assert.equal(context.classificarMovimentoDre_(movements[1], []), 'receita_produtos');
  assert.equal(context.classificarMovimentoDre_(movements[2], []), 'despesas_estrutura');
  assert.equal(context.classificarMovimentoDre_(movements[3], []), 'retirada');
  assert.equal(context.classificarMovimentoDre_(movements[4], []), 'nao_classificado');
});

test('monta janeiro a dezembro e total anual em centavos', () => {
  const dre = context.montarDreAnual_(movements, [], 2026);
  assert.equal(dre.linhas.receita_servicos.meses.length, 12);
  assert.equal(dre.linhas.receita_servicos.meses[0], 100000);
  assert.equal(dre.linhas.receita_servicos.meses[1], 50000);
  assert.equal(dre.linhas.resultado_liquido.total, 140000);
  assert.equal(dre.linhas.retirada.total, 10000);
  assert.equal(dre.naoClassificados.saidas, 5000);
});

test('conciliação técnica fecha mesmo com pendência', () => {
  const dre = context.montarDreAnual_(movements, [], 2026);
  assert.equal(dre.conciliacao.diferencaTecnica, 0);
  assert.equal(dre.provisoria, true);
});

test('ano vazio não inventa melhor ou pior mês', () => {
  const dre = context.montarDreAnual_([], [], 2026);
  assert.equal(dre.indicadores.melhorMes, null);
  assert.equal(dre.indicadores.piorMes, null);
  assert.equal(dre.indicadores.margem, 0);
});
