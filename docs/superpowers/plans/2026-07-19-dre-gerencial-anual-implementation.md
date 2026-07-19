# DRE Gerencial Anual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar uma DRE Gerencial Anual por regime de caixa com janeiro a dezembro, total anual, classificação auditável, detalhamento por célula e conciliação matemática.

**Architecture:** Calcular a DRE no backend a partir de linhas ativas de `caixa`, sempre em centavos. Isolar classificação e agregação em `DreRegras.gs`, persistir apenas classificações explícitas e regras de mapeamento, e entregar ao frontend uma estrutura anual pronta para tabela, indicadores, gráfico e drill-down sem alterar o financeiro mensal existente.

**Tech Stack:** HTML/CSS/JavaScript sem framework, Google Apps Script V8, Google Sheets, Vercel, Node.js 20+ com `node:test`.

## Global Constraints

- O relatório é gerencial por regime de caixa, não demonstração contábil oficial.
- Não acessar nem gravar a planilha real durante implementação ou testes.
- Não adicionar dependências de runtime ou de teste.
- Processar dinheiro em centavos inteiros em classificação, agregação, subtotal e conciliação.
- Não alterar valor, tipo, data, forma de pagamento ou histórico de um lançamento ao classificá-lo.
- Preservar integralmente o financeiro mensal e suas rotas atuais.
- Retiradas ficam fora do resultado líquido gerencial e aparecem separadas.
- Parcelas futuras não entram antes do recebimento ou pagamento registrado em `caixa`.
- Movimento incerto vai para `nao_classificado`; nunca inferir categoria genérica silenciosamente.
- Relatório com qualquer pendência exibe “DRE provisória”.
- Textos de API e planilha devem ser escapados ao renderizar.
- Atualizar `decisões.md`, `README.md` e fixture visual sem dados reais.

## File Structure

- Create: `DreRegras.gs` — enumeração, classificação, agregação, fórmulas, detalhe e conciliação.
- Create: `tests/dre-rules.test.cjs` — testes unitários determinísticos da DRE.
- Create: `tests/dre-backend.test.cjs` — testes dos contratos do backend.
- Modify: `Código.gs` — schema, mapeamentos, reclassificação e rotas.
- Modify: `index.html` — tela anual, tabela, gráfico, detalhe e classificação.
- Modify: `tests/static-regressions.test.cjs` — garantias estáticas e sintaxe.
- Modify: `tests/visual-fixture-server.cjs` — DRE sintética para inspeção.
- Modify: `.claspignore` — incluir `DreRegras.gs`.
- Modify: `README.md` — uso, interpretação e implantação.
- Modify: `decisões.md` — regras financeiras e riscos.

---

### Task 1: Motor puro de classificação e agregação

**Files:**
- Create: `DreRegras.gs`
- Create: `tests/dre-rules.test.cjs`
- Modify: `.claspignore`

**Interfaces:**
- Produces: `DRE_CATEGORIAS_`.
- Produces: `classificarMovimentoDre_(movimento, mapeamentos) -> string`.
- Produces: `montarDreAnual_(movimentos, mapeamentos, ano) -> DreAnual`.
- Produces: `detalharCelulaDre_(movimentosClassificados, linha, mes) -> array`.
- `DreAnual` contains `ano`, `linhas`, `totais`, `indicadores`, `naoClassificados`, `conciliacao` and `movimentosClassificados`.

- [ ] **Step 1: Write failing pure-rule tests**

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/dre-rules.test.cjs`

Expected: FAIL with `ENOENT` for `DreRegras.gs`.

- [ ] **Step 3: Implement constants and safe classification**

```js
var DRE_CATEGORIAS_ = [
  'receita_servicos','receita_produtos','outras_receitas','deducoes',
  'custos_variaveis','despesas_pessoal','despesas_estrutura',
  'despesas_operacionais','resultado_financeiro','retirada','fora_dre'
];

function dreCentavos_(value) {
  var number = Number(String(value == null ? 0 : value).replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function classificarMovimentoDre_(movement, mappings) {
  if (movement.isRetirada === true || movement.isRetirada === 'true' || movement.categoria === 'Retirada Pessoal') return 'retirada';
  if (DRE_CATEGORIAS_.indexOf(movement.dreCategoria) >= 0) return movement.dreCategoria;
  var mapping = (mappings || []).find(function (rule) {
    return rule.ativo !== 'false' &&
      (!rule.tipo || rule.tipo === movement.tipo) &&
      (!rule.categoriaCaixa || rule.categoriaCaixa === movement.categoria) &&
      (!rule.itemTipo || rule.itemTipo === movement.itemTipo);
  });
  if (mapping && DRE_CATEGORIAS_.indexOf(mapping.dreCategoria) >= 0) return mapping.dreCategoria;
  if (movement.tipo === 'entrada' && (movement.itemTipo === 'agendamento' || movement.itemTipo === 'servico')) return 'receita_servicos';
  if (movement.tipo === 'entrada' && movement.itemTipo === 'produto') return 'receita_produtos';
  if (movement.tipo === 'saida' && ['Aluguel','Manutenção'].indexOf(movement.categoria) >= 0) return 'despesas_estrutura';
  if (movement.tipo === 'saida' && ['Material','Compra de produto'].indexOf(movement.categoria) >= 0) return 'custos_variaveis';
  if (movement.tipo === 'saida' && movement.categoria === 'Salário') return 'despesas_pessoal';
  return 'nao_classificado';
}
```

- [ ] **Step 4: Implement annual aggregation and formulas**

```js
function novaLinhaDre_() {
  return { meses:Array(12).fill(0), total:0 };
}

function valorLinhaDre_(movement, category, cents) {
  if (category === 'resultado_financeiro') return movement.tipo === 'saida' ? -cents : cents;
  if (['deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','retirada'].indexOf(category) >= 0) {
    return movement.tipo === 'entrada' ? -cents : cents;
  }
  return movement.tipo === 'saida' ? -cents : cents;
}

function montarDreAnual_(movements, mappings, year) {
  var lines = {};
  DRE_CATEGORIAS_.concat(['nao_classificado','receita_liquida','margem_contribuicao','resultado_liquido','resultado_apos_retiradas']).forEach(function (key) {
    lines[key] = novaLinhaDre_();
  });
  var classified = [];
  var rawEligible = 0;
  var unclassifiedIn = 0;
  var unclassifiedOut = 0;
  var monthsWithMovement = {};
  (movements || []).forEach(function (movement) {
    var iso = String(movement.data || '').slice(0, 10);
    if (Number(iso.slice(0, 4)) !== Number(year)) return;
    var month = Number(iso.slice(5, 7)) - 1;
    if (month < 0 || month > 11) return;
    var category = classificarMovimentoDre_(movement, mappings);
    var cents = dreCentavos_(movement.valor);
    var sign = movement.tipo === 'saida' ? -1 : 1;
    if (category !== 'fora_dre') rawEligible += sign * cents;
    if (category !== 'fora_dre') monthsWithMovement[month] = true;
    if (category === 'nao_classificado') {
      if (movement.tipo === 'entrada') unclassifiedIn += cents;
      else unclassifiedOut += cents;
      lines.nao_classificado.meses[month] += sign * cents;
    } else if (category !== 'fora_dre') {
      lines[category].meses[month] += valorLinhaDre_(movement, category, cents);
    }
    classified.push(Object.assign({}, movement, { dreCategoriaResolvida:category, mes:month, valorCentavos:cents }));
  });
  for (var month = 0; month < 12; month += 1) {
    lines.receita_liquida.meses[month] =
      lines.receita_servicos.meses[month] + lines.receita_produtos.meses[month] +
      lines.outras_receitas.meses[month] - lines.deducoes.meses[month];
    lines.margem_contribuicao.meses[month] =
      lines.receita_liquida.meses[month] - lines.custos_variaveis.meses[month];
    lines.resultado_liquido.meses[month] =
      lines.margem_contribuicao.meses[month] - lines.despesas_pessoal.meses[month] -
      lines.despesas_estrutura.meses[month] - lines.despesas_operacionais.meses[month] +
      lines.resultado_financeiro.meses[month];
    lines.resultado_apos_retiradas.meses[month] =
      lines.resultado_liquido.meses[month] - lines.retirada.meses[month];
  }
  Object.keys(lines).forEach(function (key) {
    lines[key].total = lines[key].meses.reduce(function (sum, value) { return sum + value; }, 0);
  });
  var unclassifiedNet = unclassifiedIn - unclassifiedOut;
  var explained = lines.resultado_apos_retiradas.total + unclassifiedNet;
  var activeMonths = Object.keys(monthsWithMovement).map(Number);
  var sorted = activeMonths.slice().sort(function (a, b) {
    return lines.resultado_liquido.meses[a] - lines.resultado_liquido.meses[b];
  });
  return {
    ano:Number(year), linhas:lines, movimentosClassificados:classified,
    provisoria:unclassifiedIn + unclassifiedOut > 0,
    naoClassificados:{ entradas:unclassifiedIn, saidas:unclassifiedOut, saldo:unclassifiedNet },
    conciliacao:{ variacaoBrutaElegivel:rawEligible, totalExplicado:explained, diferencaTecnica:rawEligible - explained },
    indicadores:{
      faturamento:lines.receita_servicos.total + lines.receita_produtos.total + lines.outras_receitas.total,
      resultado:lines.resultado_liquido.total,
      margem:lines.receita_liquida.total ? lines.resultado_liquido.total / lines.receita_liquida.total : 0,
      melhorMes:sorted.length ? sorted[sorted.length - 1] : null,
      piorMes:sorted.length ? sorted[0] : null
    }
  };
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/dre-rules.test.cjs`

Expected: all DRE rule tests PASS.

- [ ] **Step 6: Include Apps Script file and commit**

Add `!DreRegras.gs` to `.claspignore`.

```bash
git add DreRegras.gs tests/dre-rules.test.cjs .claspignore
git commit -m "test: adicionar motor da DRE anual"
```

### Task 2: Classificação persistente e mapeamentos

**Files:**
- Create: `tests/dre-backend.test.cjs`
- Modify: `Código.gs`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- Appends `dreCategoria` to `SCHEMAS.caixa`.
- Produces sheet `dre_mapeamento`.
- Produces: `salvarClassificacaoDre_(body)`, `salvarMapeamentoDre_(body)`, `listarMapeamentosDre_()`.
- Produces read action `getDreMapeamentos`.
- Produces write actions `saveDreClassificacao` and `saveDreMapeamento`.

- [ ] **Step 1: Add failing backend contract tests**

```js
test('caixa recebe classificação sem reordenar colunas existentes', () => {
  assert.match(backend, /caixa:\s*\[[\s\S]{0,500}'dreCategoria'/);
  assert.match(backend, /dre_mapeamento:\s*\[/);
});
test('backend expõe somente rotas autenticadas de DRE', () => {
  for (const action of ['getDreMapeamentos','saveDreClassificacao','saveDreMapeamento']) {
    assert.match(backend, new RegExp("case '" + action + "':"));
  }
});
test('reclassificação escreve categoria e atualização, não valor ou data', () => {
  assert.match(backend, /function salvarClassificacaoDre_/);
  assert.match(backend, /SCHEMAS\.caixa\.indexOf\('dreCategoria'\)/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/dre-backend.test.cjs tests/static-regressions.test.cjs`

Expected: FAIL for missing schema and actions.

- [ ] **Step 3: Add schema definitions**

```js
caixa: [
  'id','data','tipo','categoria','clienteId','clienteNome',
  'itemId','itemNome','itemTipo','valor','formaPagamento',
  'observacoes','isRetirada','criadoEm','atualizadoEm','deletadoEm',
  'dreCategoria'
],
dre_mapeamento: [
  'id','tipo','categoriaCaixa','itemTipo','dreCategoria','ativo',
  'criadoEm','atualizadoEm','deletadoEm'
]
```

- [ ] **Step 4: Implement guarded single-record classification**

```js
function validarCategoriaDre_(value) {
  return DRE_CATEGORIAS_.indexOf(String(value || '')) >= 0;
}

function salvarClassificacaoDre_(body) {
  return withDocumentLock_(function () {
    var rowNum = rowNumForId_('caixa', cleanId_(body.id));
    if (!rowNum) return { error:'Lançamento não encontrado.' };
    if (!validarCategoriaDre_(body.dreCategoria)) return { error:'Categoria da DRE inválida.' };
    var sheet = getSheet('caixa');
    sheet.getRange(rowNum, SCHEMAS.caixa.indexOf('dreCategoria') + 1).setValue(body.dreCategoria);
    sheet.getRange(rowNum, SCHEMAS.caixa.indexOf('atualizadoEm') + 1).setValue(nowIso());
    invalidateSheetCache_('caixa');
    return { id:body.id, dreCategoria:body.dreCategoria };
  });
}
```

- [ ] **Step 5: Implement optional mapping**

```js
function salvarMapeamentoDre_(body) {
  var data = body.data || {};
  if (!validarCategoriaDre_(data.dreCategoria)) return { error:'Categoria da DRE inválida.' };
  return upsertById_('dre_mapeamento', {
    id:data.id || '',
    tipo:['entrada','saida',''].indexOf(data.tipo || '') >= 0 ? data.tipo || '' : '',
    categoriaCaixa:cleanText_(data.categoriaCaixa, 120),
    itemTipo:cleanText_(data.itemTipo, 40),
    dreCategoria:data.dreCategoria,
    ativo:normalizeBoolStr(data.ativo, 'true')
  });
}
```

- [ ] **Step 6: Add routes, run tests and commit**

```js
case 'getDreMapeamentos':    return ok(getCachedRows_('dre_mapeamento'));
case 'saveDreClassificacao': return result(salvarClassificacaoDre_(b));
case 'saveDreMapeamento':    return result(salvarMapeamentoDre_(b));
```

Run: `npm test`

Expected: all tests PASS.

```bash
git add Código.gs tests/dre-backend.test.cjs tests/static-regressions.test.cjs
git commit -m "feat: persistir classificações da DRE"
```

### Task 3: Relatório anual, detalhe e conciliação

**Files:**
- Modify: `DreRegras.gs`
- Modify: `Código.gs`
- Modify: `tests/dre-rules.test.cjs`
- Modify: `tests/dre-backend.test.cjs`

**Interfaces:**
- Produces read actions `getDreAnual` and `getDreDetalhe`.
- `getDreAnual` returns no raw movements; returns annual rows, indicators, provisional status and reconciliation.
- `getDreDetalhe` returns escaped-ready movement objects for exactly one line and optional month.

- [ ] **Step 1: Add failing detail and route tests**

```js
test('detalhe soma a célula selecionada', () => {
  const dre = context.montarDreAnual_(movements, [], 2026);
  const detail = context.detalharCelulaDre_(dre.movimentosClassificados, 'receita_servicos', 1);
  assert.equal(detail.reduce((sum, row) => sum + row.valorCentavos, 0), 100000);
});
test('backend expõe relatório e detalhe como leituras autenticadas', () => {
  assert.match(backend, /case 'getDreAnual':/);
  assert.match(backend, /case 'getDreDetalhe':/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/dre-rules.test.cjs tests/dre-backend.test.cjs`

Expected: FAIL for missing detail and routes.

- [ ] **Step 3: Implement deterministic cell detail**

```js
function detalharCelulaDre_(classified, line, monthOneBased) {
  var month = monthOneBased ? Number(monthOneBased) - 1 : null;
  var composite = {
    receita_liquida:['receita_servicos','receita_produtos','outras_receitas','deducoes'],
    margem_contribuicao:['receita_servicos','receita_produtos','outras_receitas','deducoes','custos_variaveis'],
    resultado_liquido:['receita_servicos','receita_produtos','outras_receitas','deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','resultado_financeiro'],
    resultado_apos_retiradas:['receita_servicos','receita_produtos','outras_receitas','deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','resultado_financeiro','retirada']
  };
  var accepted = composite[line] || [line];
  var isComposite = Object.prototype.hasOwnProperty.call(composite, line);
  return (classified || []).filter(function (row) {
    return accepted.indexOf(row.dreCategoriaResolvida) >= 0 && (month === null || row.mes === month);
  }).map(function (row) {
    var leafValue = valorLinhaDre_(row, row.dreCategoriaResolvida, row.valorCentavos);
    var negativeInComposite = ['deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','retirada'].indexOf(row.dreCategoriaResolvida) >= 0;
    var contribution = isComposite && negativeInComposite ? -leafValue : leafValue;
    return Object.assign({}, row, { valorContribuicaoCentavos:contribution });
  });
}
```

- [ ] **Step 4: Add authenticated backend report functions**

```js
function getDreAnual_(params) {
  var year = parseInt(params.ano, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return { error:'Ano inválido.' };
  var dre = montarDreAnual_(getCachedRows_('caixa'), getCachedRows_('dre_mapeamento'), year);
  delete dre.movimentosClassificados;
  return dre;
}

function getDreDetalhe_(params) {
  var year = parseInt(params.ano, 10);
  var month = params.mes ? parseInt(params.mes, 10) : null;
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return { error:'Ano inválido.' };
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return { error:'Mês inválido.' };
  var dre = montarDreAnual_(getCachedRows_('caixa'), getCachedRows_('dre_mapeamento'), year);
  return detalharCelulaDre_(dre.movimentosClassificados, String(params.linha || ''), month);
}
```

- [ ] **Step 5: Add routes, run tests and commit**

```js
case 'getDreAnual':   return result(getDreAnual_(e.parameter));
case 'getDreDetalhe': return result(getDreDetalhe_(e.parameter));
```

Run: `npm test`

Expected: annual totals, detail sums and reconciliation tests PASS.

```bash
git add DreRegras.gs Código.gs tests/dre-rules.test.cjs tests/dre-backend.test.cjs
git commit -m "feat: calcular DRE gerencial anual"
```

### Task 4: Interface anual e classificação de pendências

**Files:**
- Modify: `index.html`
- Modify: `tests/static-regressions.test.cjs`
- Modify: `tests/visual-fixture-server.cjs`

**Interfaces:**
- Consumes: `getDreAnual`, `getDreDetalhe`, `getDreMapeamentos`, `saveDreClassificacao`, `saveDreMapeamento`.
- Produces view `dre-anual`, `loadDreAnual()`, `renderDreAnual(data)`, `abrirDetalheDre(linha, mes)` and `salvarClassificacaoDre(id)`.

- [ ] **Step 1: Add failing UI contracts**

```js
test('DRE anual possui navegação, seletor, tabela e aviso provisório', () => {
  assert.match(html, /data-view="dre-anual"/);
  assert.match(html, /id="view-dre-anual"/);
  assert.match(html, /id="dre-ano"/);
  assert.match(html, /DRE provisória/);
  assert.match(html, /function loadDreAnual\(/);
});
test('detalhe e classificação usam rotas dedicadas', () => {
  assert.match(html, /action:'getDreDetalhe'/);
  assert.match(html, /action:'saveDreClassificacao'/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/static-regressions.test.cjs`

Expected: FAIL for missing view and routes.

- [ ] **Step 3: Add annual data loading**

```js
async function loadDreAnual() {
  const ano = Number(qs('#dre-ano')?.value || new Date().getFullYear());
  const result = await api({ action:'getDreAnual', token:state.token, ano:ano });
  if (result.status !== 'ok') return toast(result.data?.message || 'Não foi possível carregar a DRE.','err');
  state.db.dreAnual = result.data;
  renderDreAnual(result.data);
}
```

- [ ] **Step 4: Render fixed rows, 12 months and total**

Define a fixed frontend row list matching the spec and never use arbitrary backend labels as HTML. Render monetary cents with the existing Brazilian currency formatter. Use a sticky first column and horizontal scroll on narrow screens.

```js
const DRE_ROWS = [
  ['receita_servicos','Receita bruta de serviços'],
  ['receita_produtos','Receita bruta de produtos'],
  ['outras_receitas','Outras receitas operacionais'],
  ['deducoes','(-) Deduções, estornos e impostos'],
  ['receita_liquida','Receita líquida','total'],
  ['custos_variaveis','(-) Custos variáveis'],
  ['margem_contribuicao','Margem de contribuição','total'],
  ['despesas_pessoal','(-) Despesas com pessoal'],
  ['despesas_estrutura','(-) Estrutura'],
  ['despesas_operacionais','(-) Outras despesas operacionais'],
  ['resultado_financeiro','(+/-) Resultado financeiro'],
  ['resultado_liquido','Resultado líquido gerencial','total'],
  ['retirada','Retiradas dos proprietários'],
  ['resultado_apos_retiradas','Resultado após retiradas','total'],
  ['nao_classificado','Movimentos a classificar','warning']
];

function renderDreTable(data) {
  const months = Array.from({ length:12 }, (_, index) => index);
  return '<div class="dre-scroll"><table class="dre-table"><thead><tr><th>Linha</th>' +
    months.map(index => '<th>' + MESES_CURTOS[index] + '</th>').join('') +
    '<th>Total</th></tr></thead><tbody>' +
    DRE_ROWS.map(([key,label,kind]) => {
      const row = data.linhas[key];
      const cells = months.map(index => '<td><button type="button" data-dre-line="' +
        attr(key) + '" data-dre-month="' + (index + 1) + '">' + moneyFromCents(row.meses[index]) +
        '</button></td>').join('');
      return '<tr class="' + attr(kind || '') + '"><th>' + safe(label) + '</th>' + cells +
        '<td><button type="button" data-dre-line="' + attr(key) + '">' +
        moneyFromCents(row.total) + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}
```

- [ ] **Step 5: Add detail, reclassification and optional future mapping**

```js
async function abrirDetalheDre(linha, mes) {
  const ano = Number(qs('#dre-ano').value);
  const result = await api({ action:'getDreDetalhe', token:state.token, ano:ano, linha:linha, mes:mes || '' });
  if (result.status !== 'ok') return toast(result.data?.message || 'Detalhe indisponível.','err');
  showDrawer(renderDetalheDre(result.data || []));
}

async function salvarClassificacaoDre(id, category, applySimilar, mapping) {
  const one = await post({ action:'saveDreClassificacao', token:state.token, id:id, dreCategoria:category });
  if (one.status !== 'ok') return toast(one.data?.message || 'Classificação não salva.','err');
  if (applySimilar) {
    const many = await post({ action:'saveDreMapeamento', token:state.token, data:Object.assign({}, mapping, { dreCategoria:category, ativo:true }) });
    if (many.status !== 'ok') return toast(many.data?.message || 'Lançamento salvo, mas o padrão não foi criado.','warn');
  }
  await loadDreAnual();
}
```

- [ ] **Step 6: Render a dependency-free monthly chart**

```js
function renderDreChart(data) {
  const revenue = data.linhas.receita_liquida.meses;
  const result = data.linhas.resultado_liquido.meses;
  const values = revenue.concat(result);
  const max = Math.max(1, ...values.map(value => Math.abs(value)));
  const width = 720, height = 240, baseline = 120, group = width / 12;
  const bars = revenue.map((value,index) => {
    const revenueH = Math.round(Math.abs(value) / max * 95);
    const resultH = Math.round(Math.abs(result[index]) / max * 95);
    const x = Math.round(index * group + 8);
    const resultY = result[index] >= 0 ? baseline - resultH : baseline;
    return '<rect x="' + x + '" y="' + (baseline - revenueH) + '" width="18" height="' + revenueH + '" class="dre-revenue"/>' +
      '<rect x="' + (x + 22) + '" y="' + resultY + '" width="18" height="' + resultH + '" class="dre-result"/>' +
      '<text x="' + (x + 20) + '" y="225" text-anchor="middle">' + MESES_CURTOS[index] + '</text>';
  }).join('');
  return '<svg class="dre-chart" viewBox="0 0 720 240" role="img" aria-label="Receita líquida e resultado por mês">' +
    '<line x1="0" y1="' + baseline + '" x2="' + width + '" y2="' + baseline + '"/>' + bars + '</svg>';
}
```

Do not introduce Chart.js or network-loaded code.

- [ ] **Step 7: Extend fixture and inspect**

Provide synthetic annual data with positive month, negative month, empty month, withdrawal, deduction, and unclassified input/output. Mock detail and classification responses.

Run: `npm run preview:fixture`

Expected: readable at desktop and 390×844, sticky row labels, no clipped totals, keyboard-operable cells, correct provisional warning and exact detail sum.

- [ ] **Step 8: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add index.html tests/static-regressions.test.cjs tests/visual-fixture-server.cjs
git commit -m "feat: criar tela da DRE anual"
```

### Task 5: Verificação financeira e documentação

**Files:**
- Modify: `README.md`
- Modify: `decisões.md`
- Modify: `docs/superpowers/plans/2026-07-19-dre-gerencial-anual-implementation.md`

**Interfaces:**
- `npm test` remains the full local regression command.
- The existing monthly finance view remains behaviorally unchanged.

- [ ] **Step 1: Run complete automated tests**

Run: `npm test`

Expected: zero failures, including old monthly finance tests.

- [ ] **Step 2: Run fixture financial checklist**

Validate service/product revenue, deductions, variable costs, payroll, structure, financial result, withdrawals, future installment exclusion, deleted record exclusion, `fora_dre`, unclassified income/outflow, provisional badge, empty year, negative month, best/worst month, detail equality and technical reconciliation.

Expected: every scenario matches the cent values prepared in the fixture and never calls real Sheets.

- [ ] **Step 3: Compare monthly regression behavior**

Open Caixa and Extrato in the fixture before and after the DRE changes.

Expected: existing monthly totals, filters, edit and delete behavior remain unchanged.

- [ ] **Step 4: Update documentation**

Document in `README.md`: cash-basis meaning, row definitions, provisional status, classification workflow, drill-down and backend-before-frontend deployment.

Record in `decisões.md`: owner withdrawals outside operating result, generic categories unclassified, explicit `fora_dre`, cents arithmetic, no year comparison and independent reconciliation paths.

- [ ] **Step 5: Verify final diff**

Run: `git diff --check`

Run: `git status --short`

Expected: only DRE implementation, tests and documentation are changed.

- [ ] **Step 6: Commit**

```bash
git add README.md decisões.md docs/superpowers/plans/2026-07-19-dre-gerencial-anual-implementation.md
git commit -m "docs: concluir DRE gerencial anual"
```
