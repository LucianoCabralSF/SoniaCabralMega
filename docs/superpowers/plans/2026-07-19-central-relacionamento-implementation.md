# Central de Relacionamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar uma Central de Relacionamento assistida por WhatsApp que transforme retornos recomendados, aniversários e campanhas em contatos mensuráveis até o retorno efetivo da cliente.

**Architecture:** Manter a aplicação estática em `index.html` e o backend Google Apps Script em `Código.gs`. Colocar regras puras de filas, telefone, vínculo e métricas em `RelacionamentoRegras.gs`, persistir estado atual, eventos e campanhas em abas separadas do Google Sheets e integrar agenda/caixa por funções idempotentes que não desfazem registros financeiros consolidados.

**Tech Stack:** HTML/CSS/JavaScript sem framework, Google Apps Script V8, Google Sheets, Vercel, Node.js 20+ com `node:test`.

## Global Constraints

- Não acessar nem gravar a planilha real durante implementação ou testes.
- Não adicionar dependências de runtime ou de teste.
- Preservar os registros existentes; novas colunas devem ser criadas pela migração já usada por `ensureSheetsOnce_`.
- O funil visível é somente `contatada → respondeu → agendou → retornou`; `pendente` e encerramento sem conversão são estados operacionais.
- Abrir o WhatsApp nunca confirma o envio; `contatada` exige confirmação humana.
- Clientes com `naoContatar=true` ou telefone inválido não podem receber mensagem.
- Repetir uma requisição não pode duplicar caixa, oportunidade, campanha ou evento.
- Textos vindos de formulário, API ou planilha devem passar pelos limites de sanitização existentes.
- O módulo de relacionamento não pode impedir agenda ou caixa de funcionarem.
- Atualizar `decisões.md`, `README.md` e a fixture visual sem usar dados reais.

## File Structure

- Create: `RelacionamentoRegras.gs` — regras puras testáveis de datas, telefone, filas, vínculo e indicadores.
- Create: `tests/relacionamento-rules.test.cjs` — testes unitários das regras puras.
- Create: `tests/relacionamento-backend.test.cjs` — testes do contrato e integrações do backend com serviços simulados.
- Modify: `Código.gs` — schemas, persistência, rotas e integração com clientes/agendamentos.
- Modify: `index.html` — navegação, conclusão com retorno, Central, campanhas e WhatsApp.
- Modify: `tests/static-regressions.test.cjs` — garantias estáticas de segurança e rotas.
- Modify: `tests/visual-fixture-server.cjs` — respostas simuladas para auditoria visual.
- Modify: `.claspignore` — incluir `RelacionamentoRegras.gs` no backend publicado.
- Modify: `README.md` — uso, teste e ordem de implantação.
- Modify: `decisões.md` — decisões e riscos residuais.

---

### Task 1: Regras puras do relacionamento

**Files:**
- Create: `RelacionamentoRegras.gs`
- Create: `tests/relacionamento-rules.test.cjs`
- Modify: `.claspignore`

**Interfaces:**
- Produces: `normalizarTelefoneWhatsApp_(telefone) -> string`.
- Produces: `filaRelacionamento_(oportunidade, hojeIso) -> "proximo" | "recuperacao" | "futuro" | "encerrado"`.
- Produces: `selecionarOportunidadeParaAgendamento_(oportunidades, dados) -> oportunidade | null`.
- Produces: `calcularIndicadoresRelacionamento_(oportunidades) -> object`, incluindo tempos médios em horas.
- Consumes: datas ISO estritas e objetos sem dependência de Apps Script.

- [x] **Step 1: Write the failing pure-rule tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'RelacionamentoRegras.gs'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'RelacionamentoRegras.gs' });

test('normaliza telefone brasileiro para WhatsApp', () => {
  assert.equal(context.normalizarTelefoneWhatsApp_('(92) 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('55 92 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('123'), '');
});

test('separa retorno próximo e recuperação', () => {
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-07-25', etapa:'pendente' }, '2026-07-19'), 'proximo');
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-07-01', etapa:'pendente' }, '2026-07-16'), 'recuperacao');
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-08-20', etapa:'pendente' }, '2026-07-19'), 'futuro');
});

test('vínculo exige contato anterior e escolhe uma oportunidade', () => {
  const selected = context.selecionarOportunidadeParaAgendamento_([
    { id:'camp_1', clienteId:'cli_1', origem:'campanha', etapa:'contatada', dataAlvo:'2026-07-10', criadoEm:'2026-07-11T10:00:00' },
    { id:'ret_1', clienteId:'cli_1', origem:'retorno', etapa:'respondeu', dataAlvo:'2026-07-15', criadoEm:'2026-07-12T10:00:00' }
  ], { clienteId:'cli_1', criadoEm:'2026-07-19T10:00:00' });
  assert.equal(selected.id, 'ret_1');
});

test('métricas nunca retornam NaN', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calcularIndicadoresRelacionamento_([]))),
    { elegiveis:0, contatadas:0, responderam:0, agendaram:0, retornaram:0, recuperadas:0, taxaContato:0, taxaResposta:0, taxaAgendamento:0, taxaRetorno:0, mediaHorasContatoAgendamento:0, mediaHorasAgendamentoRetorno:0 }
  );
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/relacionamento-rules.test.cjs`

Expected: FAIL with `ENOENT` for `RelacionamentoRegras.gs`.

- [x] **Step 3: Implement the pure rules**

```js
var REL_ETAPAS_ = ['pendente','contatada','respondeu','agendou','retornou'];

function relDateMs_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return NaN;
  var parts = String(iso).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function normalizarTelefoneWhatsApp_(telefone) {
  var digits = String(telefone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return /^55\d{10,11}$/.test(digits) ? digits : '';
}

function filaRelacionamento_(oportunidade, hojeIso) {
  if (!oportunidade || oportunidade.encerramentoMotivo || oportunidade.etapa === 'retornou') return 'encerrado';
  var delta = Math.floor((relDateMs_(hojeIso) - relDateMs_(oportunidade.dataAlvo)) / 86400000);
  if (!Number.isFinite(delta)) return 'futuro';
  if (delta >= 15) return 'recuperacao';
  if (delta >= -7) return 'proximo';
  return 'futuro';
}

function selecionarOportunidadeParaAgendamento_(oportunidades, dados) {
  var allowed = { contatada:true, respondeu:true };
  var list = (oportunidades || []).filter(function (item) {
    return String(item.clienteId) === String(dados.clienteId) &&
      allowed[item.etapa] && !item.agendamentoId && !item.encerramentoMotivo &&
      String(item.criadoEm || '') <= String(dados.criadoEm || '');
  });
  if (dados.oportunidadeId) {
    var explicit = list.find(function (item) { return item.id === dados.oportunidadeId; });
    if (explicit) return explicit;
  }
  list.sort(function (a, b) {
    var pa = a.origem === 'retorno' ? 0 : 1;
    var pb = b.origem === 'retorno' ? 0 : 1;
    return pa - pb || String(a.dataAlvo).localeCompare(String(b.dataAlvo)) ||
      String(b.criadoEm).localeCompare(String(a.criadoEm));
  });
  return list[0] || null;
}

function calcularIndicadoresRelacionamento_(oportunidades) {
  var rank = { pendente:0, contatada:1, respondeu:2, agendou:3, retornou:4 };
  var out = { elegiveis:0, contatadas:0, responderam:0, agendaram:0, retornaram:0, recuperadas:0 };
  (oportunidades || []).filter(function (item) { return !item.encerramentoMotivo; }).forEach(function (item) {
    var value = rank[item.etapa] || 0;
    out.elegiveis += 1;
    if (value >= 1) out.contatadas += 1;
    if (value >= 2) out.responderam += 1;
    if (value >= 3) out.agendaram += 1;
    if (value >= 4) out.retornaram += 1;
    if (value >= 4 && item.recuperacaoAoContatar === 'true') out.recuperadas += 1;
  });
  out.taxaContato = out.elegiveis ? out.contatadas / out.elegiveis : 0;
  out.taxaResposta = out.contatadas ? out.responderam / out.contatadas : 0;
  out.taxaAgendamento = out.responderam ? out.agendaram / out.responderam : 0;
  out.taxaRetorno = out.agendaram ? out.retornaram / out.agendaram : 0;
  var contatoAgendamento = (oportunidades || []).filter(function (item) {
    return item.contatadaEm && item.agendouEm;
  }).map(function (item) { return (new Date(item.agendouEm) - new Date(item.contatadaEm)) / 3600000; });
  var agendamentoRetorno = (oportunidades || []).filter(function (item) {
    return item.agendouEm && item.retornouEm;
  }).map(function (item) { return (new Date(item.retornouEm) - new Date(item.agendouEm)) / 3600000; });
  out.mediaHorasContatoAgendamento = contatoAgendamento.length ?
    contatoAgendamento.reduce(function (sum, value) { return sum + value; }, 0) / contatoAgendamento.length : 0;
  out.mediaHorasAgendamentoRetorno = agendamentoRetorno.length ?
    agendamentoRetorno.reduce(function (sum, value) { return sum + value; }, 0) / agendamentoRetorno.length : 0;
  return out;
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/relacionamento-rules.test.cjs`

Expected: 4 tests PASS.

- [x] **Step 5: Include the new Apps Script file**

Add `!RelacionamentoRegras.gs` to `.claspignore`, keeping the existing `!Código.gs`, `!Regras.gs` and `!appsscript.json` entries.

Run: `node --test tests/static-regressions.test.cjs`

Expected: existing static tests PASS.

- [x] **Step 6: Commit**

```bash
git add RelacionamentoRegras.gs tests/relacionamento-rules.test.cjs .claspignore
git commit -m "test: adicionar regras do relacionamento"
```

### Task 2: Schemas, eventos e contratos autenticados

**Files:**
- Create: `tests/relacionamento-backend.test.cjs`
- Modify: `Código.gs`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- Produces: sheets `relacionamento`, `relacionamento_eventos` e `campanhas`.
- Produces: `listarRelacionamento_(params)`, `salvarEtapaRelacionamento_(body)`, `confirmarContato_(body)`.
- Produces read actions `getRelacionamento`, `getRelacionamentoResumo`, `getRelacionamentoEventos`, `getCampanhas`.
- Produces write actions `confirmarContato`, `saveRelacionamentoEtapa`.

- [x] **Step 1: Add failing schema and route tests**

```js
test('backend declara estruturas auditáveis de relacionamento', () => {
  for (const name of ['relacionamento','relacionamento_eventos','campanhas']) {
    assert.match(backend, new RegExp(name + ':\\s*\\['));
  }
  assert.match(backend, /'naoContatar'/);
  assert.match(backend, /'retornoRecomendado'/);
  assert.match(backend, /'oportunidadeId'/);
});

test('rotas de relacionamento são autenticadas', () => {
  for (const action of ['getRelacionamento','getRelacionamentoResumo','getRelacionamentoEventos','getCampanhas','confirmarContato','saveRelacionamentoEtapa']) {
    assert.match(backend, new RegExp("case '" + action + "':"));
  }
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `node --test tests/static-regressions.test.cjs tests/relacionamento-backend.test.cjs`

Expected: FAIL because schemas and routes are absent.

- [x] **Step 3: Extend schemas without reordering existing columns**

```js
relacionamento: [
  'id','clienteId','clienteNome','origem','referenciaId','campanhaId','dataAlvo','etapa',
  'telefoneContato','mensagemContato','contatadaEm','respondeuEm','agendamentoId',
  'agendouEm','retornouEm','recuperacaoAoContatar','encerramentoMotivo','observacoes',
  'criadoEm','atualizadoEm','deletadoEm'
],
relacionamento_eventos: [
  'id','oportunidadeId','clienteId','tipo','etapaAnterior','etapaNova','origemAlteracao',
  'dataHora','telefone','mensagem','observacoes','criadoEm','atualizadoEm','deletadoEm'
],
campanhas: [
  'id','nome','mensagemModelo','dataInicio','dataFim','criteriosJson','status',
  'criadoEm','atualizadoEm','deletadoEm'
]
```

Append `naoContatar` to `clientes`; append `retornoRecomendado`, `retornoMotivo` and `oportunidadeId` to `agendamentos`.

Also persist `naoContatar` in `saveCliente` and the three new appointment fields in `saveAgendamentoUnlocked_`; normalize the boolean with `normalizeBoolStr`.

- [x] **Step 4: Implement audited state changes**

```js
function registrarEventoRelacionamentoUnlocked_(data) {
  return upsertByIdUnlocked_('relacionamento_eventos', {
    oportunidadeId:data.oportunidadeId, clienteId:data.clienteId, tipo:data.tipo,
    etapaAnterior:data.etapaAnterior || '', etapaNova:data.etapaNova || '',
    origemAlteracao:data.origemAlteracao || 'manual', dataHora:nowIso(),
    telefone:cleanText_(data.telefone, 30), mensagem:cleanText_(data.mensagem, 2000),
    observacoes:cleanText_(data.observacoes, 1000)
  });
}

function atualizarEtapaRelacionamentoUnlocked_(item, etapaNova, meta) {
  var rank = { pendente:0, contatada:1, respondeu:2, agendou:3, retornou:4 };
  var atual = String(item.etapa || 'pendente');
  if (!Object.prototype.hasOwnProperty.call(rank, etapaNova)) return { error:'Etapa inválida.' };
  if (meta.origemAlteracao === 'automatica' && rank[etapaNova] < rank[atual]) return { error:'A etapa automática não pode retroceder.' };
  var field = { contatada:'contatadaEm', respondeu:'respondeuEm', agendou:'agendouEm', retornou:'retornouEm' }[etapaNova];
  var record = Object.assign({}, item, { etapa:etapaNova });
  if (field && !record[field]) record[field] = nowIso();
  var saved = upsertByIdUnlocked_('relacionamento', record);
  if (saved.error) return saved;
  var event = registrarEventoRelacionamentoUnlocked_({
    oportunidadeId:item.id, clienteId:item.clienteId, tipo:'mudanca_etapa',
    etapaAnterior:atual, etapaNova:etapaNova, origemAlteracao:meta.origemAlteracao,
    telefone:meta.telefone, mensagem:meta.mensagem, observacoes:meta.observacoes
  });
  if (event.error) {
    upsertByIdUnlocked_('relacionamento', item);
    return event;
  }
  return saved;
}
```

- [x] **Step 5: Add route dispatch**

```js
case 'getRelacionamento':       return ok(listarRelacionamento_(e.parameter));
case 'getRelacionamentoResumo': return ok(calcularIndicadoresRelacionamento_(listarRelacionamento_(e.parameter)));
case 'getRelacionamentoEventos': return ok(getCachedRows_('relacionamento_eventos').filter(function (row) {
  return !e.parameter.oportunidadeId || row.oportunidadeId === e.parameter.oportunidadeId;
}));
case 'getCampanhas':             return ok(getCachedRows_('campanhas'));
case 'confirmarContato':         return result(confirmarContato_(b));
case 'saveRelacionamentoEtapa':  return result(salvarEtapaRelacionamento_(b));
```

- [x] **Step 6: Run tests and verify GREEN**

Run: `npm test`

Expected: schema, route, syntax and existing regression tests PASS.

- [x] **Step 7: Commit**

```bash
git add Código.gs tests/relacionamento-backend.test.cjs tests/static-regressions.test.cjs
git commit -m "feat: persistir funil de relacionamento"
```

### Task 3: Retorno recomendado e automação com a agenda

**Files:**
- Modify: `Código.gs`
- Modify: `tests/relacionamento-backend.test.cjs`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- Produces: `garantirOportunidadeRetornoUnlocked_(appointment, recommendation)`.
- Produces: `vincularOportunidadeAoAgendamentoUnlocked_(appointment)`.
- Produces: `marcarRetornoDoAgendamentoUnlocked_(appointment)`.
- Produces: `encerrarPendentesPorAgendamentoEspontaneoUnlocked_(appointment)`.
- Extends: `completeAppointment` with `returnRecommendation` and response `relationship`.

- [x] **Step 1: Add failing integration contract tests**

```js
test('conclusão aceita retorno ou escolha sem retorno', () => {
  assert.match(backend, /returnRecommendation/);
  assert.match(backend, /semRetorno/);
  assert.match(backend, /garantirOportunidadeRetornoUnlocked_/);
});
test('falha no CRM não desfaz atendimento e caixa', () => {
  assert.match(backend, /completed:\s*true[\s\S]{0,400}relationship:/);
});
test('agenda vincula oportunidade e conclusão marca retorno', () => {
  assert.match(backend, /vincularOportunidadeAoAgendamentoUnlocked_/);
  assert.match(backend, /marcarRetornoDoAgendamentoUnlocked_/);
  assert.match(backend, /encerrarPendentesPorAgendamentoEspontaneoUnlocked_/);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/relacionamento-backend.test.cjs tests/static-regressions.test.cjs`

Expected: FAIL for missing recommendation and agenda integration.

- [x] **Step 3: Validate the recommendation before writing agenda or cash**

```js
function validarRecomendacaoRetorno_(appointment, recommendation) {
  if (recommendation && recommendation.semRetorno === true) return { semRetorno:true };
  if (!recommendation || !recommendation.data) return { error:'Informe o próximo retorno ou escolha “sem retorno recomendado”.' };
  var dataAlvo = toISO(recommendation.data);
  if (dataAlvo < normDate(appointment.data)) return { error:'O retorno não pode ser anterior ao atendimento.' };
  return { data:dataAlvo, motivo:cleanText_(recommendation.motivo || appointment.servicos, 1000), semRetorno:false };
}
```

Call this function at the beginning of `concluirAgendamentoComCaixa_` and return its error before the first sheet write.

- [x] **Step 4: Implement idempotent return creation**

```js
function garantirOportunidadeRetornoUnlocked_(appointment, recommendation) {
  if (recommendation.semRetorno === true) return { skipped:true };
  var reference = 'retorno:' + appointment.id;
  var existing = getCachedRows_('relacionamento').find(function (item) {
    return item.origem === 'retorno' && item.referenciaId === reference;
  });
  if (existing) return { item:existing, duplicate:true };
  return upsertByIdUnlocked_('relacionamento', {
    clienteId:appointment.clienteId, clienteNome:appointment.clienteNome,
    origem:'retorno', referenciaId:reference, dataAlvo:recommendation.data, etapa:'pendente',
    observacoes:recommendation.motivo
  });
}
```

- [x] **Step 5: Keep CRM failure non-destructive after core completion**

```js
var relationship = { ok:true };
try {
  var prior = marcarRetornoDoAgendamentoUnlocked_(savedAppointment.item || savedAppointment);
  var next = garantirOportunidadeRetornoUnlocked_(savedAppointment.item || savedAppointment, b.returnRecommendation || {});
  relationship.priorOpportunityId = prior && prior.id || '';
  relationship.opportunityId = next && next.id || next && next.item && next.item.id || '';
} catch (relationshipError) {
  relationship = { ok:false, warning:'Atendimento e caixa concluídos; relacionamento pendente: ' + relationshipError.message };
}
return { completed:true, cashId:savedCash.id, relationship:relationship };
```

- [x] **Step 6: Implement automatic linking and spontaneous closure**

```js
function vincularOportunidadeAoAgendamentoUnlocked_(appointment) {
  var selected = selecionarOportunidadeParaAgendamento_(getCachedRows_('relacionamento'), {
    clienteId:appointment.clienteId,
    oportunidadeId:appointment.oportunidadeId,
    criadoEm:appointment.criadoEm || nowIso()
  });
  if (!selected) return null;
  selected.agendamentoId = appointment.id;
  var saved = atualizarEtapaRelacionamentoUnlocked_(selected, 'agendou', { origemAlteracao:'automatica' });
  return saved.error ? null : selected;
}

function marcarRetornoDoAgendamentoUnlocked_(appointment) {
  if (!appointment.oportunidadeId) return null;
  var item = getCachedRows_('relacionamento').find(function (row) { return row.id === appointment.oportunidadeId; });
  if (!item) return null;
  var saved = atualizarEtapaRelacionamentoUnlocked_(item, 'retornou', { origemAlteracao:'automatica' });
  return saved.error ? null : item;
}

function encerrarPendentesPorAgendamentoEspontaneoUnlocked_(appointment) {
  getCachedRows_('relacionamento').filter(function (item) {
    return item.clienteId === appointment.clienteId && item.etapa === 'pendente' &&
      !item.encerramentoMotivo && item.dataAlvo <= appointment.data;
  }).forEach(function (item) {
    var prior = Object.assign({}, item);
    item.encerramentoMotivo = 'retorno_espontaneo';
    var saved = upsertByIdUnlocked_('relacionamento', item);
    if (!saved.error) registrarEventoRelacionamentoUnlocked_({
      oportunidadeId:item.id, clienteId:item.clienteId, tipo:'encerramento',
      etapaAnterior:'pendente', etapaNova:'pendente', origemAlteracao:'automatica',
      observacoes:'Cliente já possuía agendamento futuro antes do contato.'
    });
    if (saved.error) upsertByIdUnlocked_('relacionamento', prior);
  });
}
```

Call `vincularOportunidadeAoAgendamentoUnlocked_` for contacted/responded opportunities. If it returns null, call `encerrarPendentesPorAgendamentoEspontaneoUnlocked_`.

- [x] **Step 7: Run full suite and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add Código.gs tests/relacionamento-backend.test.cjs tests/static-regressions.test.cjs
git commit -m "feat: integrar retornos com a agenda"
```

### Task 4: Filas, aniversários e campanhas

**Files:**
- Modify: `Código.gs`
- Modify: `tests/relacionamento-backend.test.cjs`

**Interfaces:**
- Produces: `materializarAniversarios_(ano)`, `salvarCampanha_(body)`, `gerarOportunidadesCampanha_(body)`.
- Produces write actions `saveCampanha` and `generateCampanha`.
- Extends `listarRelacionamento_(params)` with `fila`, `telefoneWhatsApp`, `telefoneValido` and `ultimoAtendimento`.

- [x] **Step 1: Add failing campaign tests**

```js
test('aniversário e campanha usam referências idempotentes', () => {
  assert.match(backend, /aniversario:/);
  assert.match(backend, /campanha:/);
  assert.match(backend, /case 'saveCampanha'/);
  assert.match(backend, /case 'generateCampanha'/);
});
test('bloqueio e telefone inválido saem da fila', () => {
  assert.match(backend, /naoContatar/);
  assert.match(backend, /normalizarTelefoneWhatsApp_/);
});
```

- [x] **Step 2: Run test and verify RED**

Run: `node --test tests/relacionamento-backend.test.cjs`

Expected: FAIL for missing birthday and campaign generation.

- [x] **Step 3: Implement idempotent birthday materialization**

```js
function materializarAniversarios_(ano) {
  var opportunities = getCachedRows_('relacionamento');
  var rows = [];
  getCachedRows_('clientes').forEach(function (client) {
    var match = String(client.aniversario || '').match(/^(\d{2})\/(\d{2})\/\d{4}$/);
    if (!match || client.naoContatar === 'true' || !normalizarTelefoneWhatsApp_(client.telefone)) return;
    var reference = 'aniversario:' + client.id + ':' + ano;
    if (opportunities.some(function (item) { return item.referenciaId === reference; })) return;
    rows.push({
      clienteId:client.id, clienteNome:client.nome, origem:'aniversario',
      referenciaId:reference, dataAlvo:ano + '-' + match[2] + '-' + match[1], etapa:'pendente'
    });
  });
  return { created:insertRowsBatch_('relacionamento', rows), total:rows.length };
}
```

- [x] **Step 4: Implement explicit campaign audience**

```js
function gerarOportunidadesCampanha_(body) {
  return withDocumentLock_(function () {
    var campaign = getCachedRows_('campanhas').find(function (item) { return item.id === body.campanhaId; });
    if (!campaign || campaign.status !== 'ativa') return { error:'Campanha não encontrada ou inativa.' };
    var ids = Array.isArray(body.clienteIds) ? body.clienteIds.map(String) : [];
    var existing = getCachedRows_('relacionamento');
    var rows = getCachedRows_('clientes').filter(function (client) {
      return ids.indexOf(String(client.id)) >= 0 && client.naoContatar !== 'true' &&
        !!normalizarTelefoneWhatsApp_(client.telefone);
    }).filter(function (client) {
      var ref = 'campanha:' + campaign.id + ':' + client.id;
      return !existing.some(function (item) { return item.referenciaId === ref; });
    }).map(function (client) {
      return {
        clienteId:client.id, clienteNome:client.nome, origem:'campanha',
        referenciaId:'campanha:' + campaign.id + ':' + client.id,
        campanhaId:campaign.id, dataAlvo:today(), etapa:'pendente'
      };
    });
    return { created:insertRowsBatch_('relacionamento', rows), total:rows.length };
  });
}
```

- [x] **Step 5: Add routes, run tests and commit**

```js
case 'saveCampanha':     return result(salvarCampanha_(b));
case 'generateCampanha': return result(gerarOportunidadesCampanha_(b));
```

Run: `npm test`

Expected: all tests PASS.

```bash
git add Código.gs tests/relacionamento-backend.test.cjs
git commit -m "feat: adicionar filas e campanhas"
```

### Task 5: Interface, WhatsApp e métricas

**Files:**
- Modify: `index.html`
- Modify: `tests/static-regressions.test.cjs`
- Modify: `tests/visual-fixture-server.cjs`

**Interfaces:**
- Consumes all relationship actions, including `getRelacionamentoEventos`.
- Produces view `relacionamento`, `loadRelacionamento()`, `renderRelacionamento()` and `abrirWhatsAppRelacionamento(id)`.
- Extends `concluirAgend(ag)` with `returnRecommendation`.

- [x] **Step 1: Add failing UI contracts**

```js
test('navegação e tela de relacionamento existem', () => {
  assert.match(html, /data-view="relacionamento"/);
  assert.match(html, /id="view-relacionamento"/);
  assert.match(html, /function loadRelacionamento\(/);
});
test('WhatsApp exige confirmação após abrir', () => {
  assert.match(html, /https:\/\/wa\.me\//);
  assert.match(html, /function confirmarContatoRelacionamento\(/);
});
test('conclusão envia retorno ou sem retorno', () => {
  assert.match(html, /returnRecommendation:/);
  assert.match(html, /semRetorno/);
});
```

- [x] **Step 2: Run static tests and verify RED**

Run: `node --test tests/static-regressions.test.cjs`

Expected: FAIL for missing navigation, view and WhatsApp flow.

- [x] **Step 3: Add completion controls and payload**

```html
<div class="fg">
  <label class="lbl" for="ag-retorno-data">Próximo retorno</label>
  <input id="ag-retorno-data" class="inp" type="date">
</div>
<label class="check-row"><input id="ag-sem-retorno" type="checkbox">Sem retorno recomendado</label>
<div class="fg">
  <label class="lbl" for="ag-retorno-motivo">Motivo</label>
  <input id="ag-retorno-motivo" class="inp" maxlength="1000">
</div>
```

```js
returnRecommendation: {
  data:qs('#ag-retorno-data').value,
  motivo:qs('#ag-retorno-motivo').value,
  semRetorno:qs('#ag-sem-retorno').checked
}
```

- [x] **Step 4: Add loading and escaped rendering**

```js
async function loadRelacionamento() {
  const [items,resumo,campanhas] = await Promise.all([
    api({ action:'getRelacionamento', token:state.token }),
    api({ action:'getRelacionamentoResumo', token:state.token }),
    api({ action:'getCampanhas', token:state.token })
  ]);
  if ([items,resumo,campanhas].some(result => result.status !== 'ok')) {
    return toast('Não foi possível atualizar o relacionamento.','err');
  }
  state.db.relacionamento = items.data || [];
  state.db.relacionamentoResumo = resumo.data || {};
  state.db.campanhas = campanhas.data || [];
  renderRelacionamento();
}
```

```js
function renderRelacionamento() {
  const root = qs('#rel-list');
  const filtered = (state.db.relacionamento || []).filter(item => {
    const queueOk = state.ui.relFila === 'todas' || item.fila === state.ui.relFila;
    const stageOk = state.ui.relEtapa === 'todas' || item.etapa === state.ui.relEtapa;
    return queueOk && stageOk;
  });
  root.innerHTML = filtered.map(item => '<article class="rel-card">' +
    '<strong>' + safe(item.clienteNome || '—') + '</strong>' +
    '<span>' + safe(item.origem || '') + ' · ' + safe(item.dataAlvo || '') + '</span>' +
    '<button type="button" data-rel-whatsapp="' + attr(item.id) + '">Abrir WhatsApp</button>' +
    '<button type="button" data-rel-stage="respondeu" data-id="' + attr(item.id) + '">Respondeu</button>' +
    '<button type="button" data-rel-history="' + attr(item.id) + '">Histórico</button>' +
    '</article>').join('') || '<div class="empty">Nenhuma oportunidade nesta fila.</div>';
}

async function abrirHistoricoRelacionamento(id) {
  const result = await api({ action:'getRelacionamentoEventos', token:state.token, oportunidadeId:id });
  if (result.status !== 'ok') return toast('Histórico indisponível.','err');
  showDrawer(renderEventosRelacionamento(result.data || []));
}
```

Render the same fields as a compact table above the mobile breakpoint; pass every API string through `safe()` or `attr()`. Provide filters for queue, stage, origin, campaign, delay and period, and apply campaign audience filters before sending explicit `clienteIds` to `generateCampanha`.

- [x] **Step 5: Implement assisted WhatsApp**

```js
async function abrirWhatsAppRelacionamento(id) {
  const item = state.db.relacionamento.find(row => row.id === id);
  if (!item || !item.telefoneValido) return toast('Telefone inválido ou contato bloqueado.','err');
  const message = await editarMensagemRelacionamento(item.mensagemSugerida || '');
  window.open('https://wa.me/' + item.telefoneWhatsApp + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
  confirmarDialogo('Confirma que a mensagem foi enviada?', async () => {
    const result = await post({ action:'confirmarContato', token:state.token, id:id, mensagem:message });
    if (result.status !== 'ok') return toast(result.data?.message || 'Contato não confirmado.','err');
    await loadRelacionamento();
  });
}
```

- [x] **Step 6: Extend the fixture and inspect layouts**

Add synthetic responses for all relationship actions: valid phone, invalid phone, blocked client, upcoming return, recovery, birthday and campaign.

Run: `npm run preview:fixture`

Expected: no horizontal overflow at 390×844 or desktop; keyboard focus, filters, stage controls and disabled contacts work.

- [x] **Step 7: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```bash
git add index.html tests/static-regressions.test.cjs tests/visual-fixture-server.cjs
git commit -m "feat: criar central de relacionamento"
```

### Task 6: Verificação e documentação

**Files:**
- Modify: `README.md`
- Modify: `decisões.md`
- Modify: `docs/superpowers/plans/2026-07-19-central-relacionamento-implementation.md`

**Interfaces:**
- `npm test` remains the full local regression command.
- Deployment order remains Apps Script before Vercel.

- [x] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: zero failures.

- [x] **Step 2: Run local end-to-end fixture checks**

Validate completion with date and without return, 7-day upcoming boundary, 15-day recovery boundary, birthday, campaign deduplication, blocked/invalid phone, WhatsApp without automatic confirmation, manual response, automatic schedule, automatic return, spontaneous booking closure, history and empty metrics.

Expected: all scenarios succeed without a real backend call.

- [x] **Step 3: Update documentation**

Document in `README.md` the Central workflow, contact confirmation, metrics, opt-out and backend-before-frontend deployment.

Record in `decisões.md` the 7/15-day windows, assisted WhatsApp, operational states, automatic attribution priority and non-destructive CRM warning.

- [x] **Step 4: Verify final diff**

Run: `git diff --check`

Run: `git status --short`

Expected: only CRM implementation, tests and documentation are changed.

- [x] **Step 5: Commit**

```bash
git add README.md decisões.md docs/superpowers/plans/2026-07-19-central-relacionamento-implementation.md
git commit -m "docs: concluir central de relacionamento"
```
