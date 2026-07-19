# Sincronização Agenda–Caixa e Lembretes Automáticos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar agenda, caixa e retornos vinculados, normalizar telefones importados e automatizar lembretes auditáveis pelo WhatsApp Business.

**Architecture:** Regras de telefone e horário ficam em funções puras; mutações vinculadas passam por serviços sob `DocumentLock`; lembretes usam uma aba de outbox idempotente e um acionador do Apps Script. A interface de Configurações administra mensagem, antecedência, credenciais mascaradas e histórico.

**Tech Stack:** Google Apps Script V8, Google Sheets, ScriptProperties, ScriptApp, UrlFetchApp, HTML/CSS/JavaScript sem framework, Node.js `node:test`, Vercel e clasp.

## Global Constraints

- Fuso obrigatório: `America/Manaus`.
- Antecedência permitida: exatamente 3 ou 4 horas; padrão 4.
- Nunca enviar antes de `horaInicio`, no horário ou depois do início do atendimento.
- Token da Meta somente em `ScriptProperties`; nunca retornar ao frontend.
- Data financeira e data/hora da agenda são independentes.
- Toda mutação nova começa com teste falhando e termina com suíte completa verde.
- Nenhum envio para telefone real durante testes ou validação visual.

---

## Estrutura de arquivos

- Criar `LembreteRegras.gs`: normalização complementar, cálculo de horário, chave idempotente e renderização de mensagem.
- Modificar `RelacionamentoRegras.gs`: normalização brasileira robusta e defesa contra prefixo `55` duplicado.
- Modificar `Código.gs`: schema, sincronização transacional, outbox, configuração segura, Meta Cloud API, acionador e rotas.
- Modificar `index.html`: importação canônica, seção de mensagens automáticas e histórico.
- Modificar `.claspignore`: incluir `LembreteRegras.gs` no deploy.
- Criar `tests/lembrete-rules.test.cjs`: regras puras.
- Criar `tests/sync-reminders-backend.test.cjs`: contratos e comportamento do backend.
- Modificar `tests/static-regressions.test.cjs`: contratos visuais, segurança e rotas.
- Modificar `tests/visual-fixture-server.cjs`: respostas da nova tela sem chamadas externas.
- Modificar `README.md` e `decisões.md`: operação, limitações e escolhas.

---

### Task 1: Regras puras de telefone e horário

**Files:**
- Create: `LembreteRegras.gs`
- Modify: `RelacionamentoRegras.gs`
- Create: `tests/lembrete-rules.test.cjs`

**Interfaces:**
- Produces: `normalizarTelefoneWhatsApp_(telefone) -> string`
- Produces: `calcularProgramacaoLembrete_(agendamento, config) -> string`
- Produces: `chaveLembreteAgendamento_(agendamento) -> string`
- Produces: `renderizarMensagemLembrete_(modelo, dados) -> string`

- [ ] **Step 1: Write the failing phone normalization tests**

```js
test('corrige 55 duplicado sem alterar número brasileiro válido', () => {
  assert.equal(ctx.normalizarTelefoneWhatsApp_('+55 55 92 99999-1111'), '5592999991111');
  assert.equal(ctx.normalizarTelefoneWhatsApp_('+55 92 99999-1111'), '5592999991111');
  assert.equal(ctx.normalizarTelefoneWhatsApp_('(92) 99999-1111'), '5592999991111');
  assert.equal(ctx.normalizarTelefoneWhatsApp_('0055 92 99999-1111'), '5592999991111');
  assert.equal(ctx.normalizarTelefoneWhatsApp_('123'), '');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/lembrete-rules.test.cjs`  
Expected: FAIL because the duplicated `55` is not corrected and reminder functions do not exist.

- [ ] **Step 3: Implement the minimal canonicalizer**

```js
function normalizarTelefoneWhatsApp_(telefone) {
  var digits = String(telefone || '').replace(/\D/g, '').replace(/^00/, '');
  while (/^5555/.test(digits) && (digits.length - 2 === 12 || digits.length - 2 === 13)) {
    digits = digits.slice(2);
  }
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  if (!/^55[1-9]\d(?:\d{8}|\d{9})$/.test(digits)) return '';
  return digits;
}
```

- [ ] **Step 4: Add failing schedule and template tests**

```js
test('programa no máximo entre antecedência e abertura', () => {
  assert.equal(ctx.calcularProgramacaoLembrete_(
    { id:'ag1', data:'2026-07-20', hora:'09:00', status:'agendado' },
    { horaInicio:'08:00', antecedenciaHoras:4 }
  ), '2026-07-20T08:00:00');
  assert.equal(ctx.calcularProgramacaoLembrete_(
    { id:'ag2', data:'2026-07-20', hora:'14:00', status:'agendado' },
    { horaInicio:'08:00', antecedenciaHoras:4 }
  ), '2026-07-20T10:00:00');
});

test('não agenda quando a abertura não antecede o atendimento', () => {
  assert.equal(ctx.calcularProgramacaoLembrete_(
    { id:'ag1', data:'2026-07-20', hora:'08:00', status:'agendado' },
    { horaInicio:'08:00', antecedenciaHoras:4 }
  ), '');
});
```

- [ ] **Step 5: Implement schedule, key and rendering functions**

Implement with integer minutes, ISO local without timezone suffix, keys containing appointment/date/time, replacement limited to `{nome}`, `{servico}`, `{salao}`, `{data}`, `{hora}`, and a maximum rendered length of 2000 characters.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test tests/lembrete-rules.test.cjs`  
Expected: all tests PASS.

```powershell
git add RelacionamentoRegras.gs LembreteRegras.gs tests/lembrete-rules.test.cjs
git commit -m "feat: adicionar regras de lembretes e telefone"
```

---

### Task 2: Sincronização e exclusão vinculada

**Files:**
- Modify: `Código.gs`
- Create: `tests/sync-reminders-backend.test.cjs`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- Produces: `agendamentoIdDoCaixa_(caixa) -> string`
- Produces: `sincronizarCaixaComAgendamentoUnlocked_(caixa) -> object`
- Produces: `sincronizarAgendamentoComCaixaUnlocked_(agendamento) -> object`
- Produces: `deleteAgendamentoVinculado_(id) -> object`
- Produces a cascade hook that Task 3 connects to `cancelarLembretesAgendamentoUnlocked_(id, motivo)` after the outbox schema exists.

- [ ] **Step 1: Write failing cascade tests**

```js
test('excluir caixa da agenda arquiva o conjunto vinculado', () => {
  const f = fixture({
    agendamentos:[{ id:'ag_1', oportunidadeId:'rel_anterior' }],
    caixa:[{ id:'cx_1', itemId:'agcash:ag_1', itemTipo:'agendamento' }],
    relacionamento:[
      { id:'rel_novo', referenciaId:'retorno:ag_1', origem:'retorno', etapa:'pendente' },
      { id:'rel_anterior', agendamentoId:'ag_1', etapa:'retornou' }
    ],
    lembretes_envios:[]
  });
  const result = f.call("deleteLancamento_('cx_1')");
  assert.equal(result.deletedAppointmentId, 'ag_1');
  assert.ok(f.deleted('agendamentos', 'ag_1'));
  assert.ok(f.deleted('caixa', 'cx_1'));
  assert.ok(f.deleted('relacionamento', 'rel_novo'));
  assert.equal(f.row('relacionamento', 'rel_anterior').agendamentoId, '');
});
```

- [ ] **Step 2: Run cascade tests and verify RED**

Run: `node --test tests/sync-reminders-backend.test.cjs`  
Expected: FAIL because current routes delete only one sheet.

- [ ] **Step 3: Implement linked resolution and idempotent cascade**

Use `getRowObjectById_` to read even soft-deleted rows, collect row snapshots before writes, archive all linked entities with one timestamp and restore snapshots on any thrown error. Register one relationship event `desvinculo_exclusao` and derive the prior stage from the `auto:agendou:<id>` event when available.

- [ ] **Step 4: Verify cascade GREEN**

Run: `node --test tests/sync-reminders-backend.test.cjs --test-name-pattern="arquiva|idempotente|órfão"`  
Expected: PASS.

- [ ] **Step 5: Write failing bidirectional edit tests**

```js
test('edição de caixa preserva vínculo e sincroniza somente campos compartilhados', () => {
  const result = f.call("saveLancamento({ id:'cx_1', itemId:'svc_9', itemTipo:'servico', clienteId:'cli_2', clienteNome:'Bia', itemNome:'Escova', valor:180, data:'2026-07-20', tipo:'entrada', formaPagamento:'pix' })");
  assert.equal(result.item.itemId, 'agcash:ag_1');
  assert.equal(f.row('agendamentos','ag_1').clienteId, 'cli_2');
  assert.equal(f.row('agendamentos','ag_1').servicos, 'Escova');
  assert.equal(f.row('agendamentos','ag_1').valor, 180);
  assert.equal(f.row('agendamentos','ag_1').data, '2026-07-19');
});
```

- [ ] **Step 6: Implement minimal edit synchronization**

Wrap public saves in one lock; preserve technical linkage from the stored cash record; synchronize client, name, service and value; never copy financial date into appointment or appointment date into cash.

- [ ] **Step 7: Verify, run full suite and commit**

Run: `npm.cmd test`  
Expected: all tests PASS.

```powershell
git add Código.gs tests/sync-reminders-backend.test.cjs tests/static-regressions.test.cjs
git commit -m "fix: sincronizar agenda caixa e retornos"
```

---

### Task 3: Schema, configuração segura e outbox

**Files:**
- Modify: `Código.gs`
- Modify: `tests/sync-reminders-backend.test.cjs`

**Interfaces:**
- Produces: `getLembretesConfig_() -> object` without token.
- Produces: `salvarLembretesConfig_(body) -> object`.
- Produces: `garantirLembreteAgendamentoUnlocked_(agendamento) -> object`.
- Produces: `cancelarLembretesAgendamentoUnlocked_(id, motivo) -> object`.

- [ ] **Step 1: Write failing schema and secret tests**

```js
test('configuração nunca devolve o token', () => {
  props.WHATSAPP_ACCESS_TOKEN = 'segredo';
  const cfg = f.call('getLembretesConfig_()');
  assert.equal(cfg.tokenConfigurado, true);
  assert.equal(JSON.stringify(cfg).includes('segredo'), false);
});

test('schema de envios termina com metadados de exclusão', () => {
  assert.match(backend, /lembretes_envios:\s*\[[\s\S]*'deletadoEm'\s*\]/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/sync-reminders-backend.test.cjs --test-name-pattern="configuração|schema"`  
Expected: FAIL because schema and routes are absent.

- [ ] **Step 3: Add schema version 5, defaults and validators**

Store non-secret fields in `config`; store access token in `SCRIPT_PROPS` under a dedicated constant. Validate enabled boolean, 3/4 hours, `v<major>.<minor>` API version, safe template name, language and numeric phone-number ID.

- [ ] **Step 4: Add idempotent outbox reconciliation**

For each eligible appointment, calculate schedule and key. Cancel pending/error rows for older keys of the same appointment, reuse an existing identical key and create one `pendente` row otherwise.

Add a regression test that seeds a pending row, calls the linked appointment deletion and asserts `status === 'cancelado'`; this is where the cascade hook from Task 2 becomes active.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm.cmd test`  
Expected: all tests PASS.

```powershell
git add Código.gs tests/sync-reminders-backend.test.cjs
git commit -m "feat: persistir configuração e fila de lembretes"
```

---

### Task 4: Provedor oficial, tentativas e acionador

**Files:**
- Modify: `Código.gs`
- Modify: `appsscript.json`
- Modify: `.claspignore`
- Modify: `tests/sync-reminders-backend.test.cjs`

**Interfaces:**
- Produces: `enviarTemplateWhatsApp_(lembrete, config) -> { messageId:string }`.
- Produces: `processarLembretesAutomaticos_() -> { enviados, erros, expirados, ignorados }`.
- Produces: `configurarTriggerLembretes_(ativo) -> { ativo:boolean }`.
- Produces: `testarWhatsAppConfig_() -> object`.

- [ ] **Step 1: Write failing provider contract tests with injected UrlFetch stub**

```js
test('só marca enviado quando a Meta devolve message id', () => {
  f.fetchReturns(200, { messages:[{ id:'wamid.123' }] });
  const result = f.call("processarLembretesAutomaticos_('2026-07-20T10:01:00')");
  assert.equal(result.enviados, 1);
  assert.equal(f.row('lembretes_envios','lem_1').providerMessageId, 'wamid.123');
  assert.equal(f.row('lembretes_envios','lem_1').status, 'enviado');
});

test('resposta sem id continua erro e não vaza bearer', () => {
  f.fetchReturns(400, { error:{ message:'Invalid OAuth access token: segredo' } });
  f.call("processarLembretesAutomaticos_('2026-07-20T10:01:00')");
  const row = f.row('lembretes_envios','lem_1');
  assert.equal(row.status, 'erro');
  assert.equal(row.ultimoErro.includes('segredo'), false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/sync-reminders-backend.test.cjs --test-name-pattern="Meta|enviado|bearer|acionador"`  
Expected: FAIL because provider and trigger do not exist.

- [ ] **Step 3: Implement Cloud API request**

Send JSON with `messaging_product: 'whatsapp'`, canonical `to`, type `template`, configured name/language and body parameters ordered as nome, serviço, salão, data and hora. Use `muteHttpExceptions:true`, parse body safely and sanitize stored errors.

- [ ] **Step 4: Implement processor and retry policy**

Claim a due row as `enviando`, send outside any duplicate claim, then update to `enviado` or `erro`. Expire when appointment start is reached. Retry at most three times and only while appointment is future and active.

- [ ] **Step 5: Implement unique 15-minute trigger management**

Delete only triggers whose handler is `processarLembretesAutomaticos_`; create exactly one with `ScriptApp.newTrigger('processarLembretesAutomaticos_').timeBased().everyMinutes(15).create()` when active.

- [ ] **Step 6: Include new backend file in clasp and verify manifest syntax**

Add `!LembreteRegras.gs` to `.claspignore`. Keep automatic scope discovery unless an explicit scopes list is added; if explicit, include spreadsheets, script external request, script properties and script triggers.

- [ ] **Step 7: Verify full suite and commit**

Run: `npm.cmd test`  
Expected: all tests PASS.

```powershell
git add Código.gs appsscript.json .claspignore tests/sync-reminders-backend.test.cjs
git commit -m "feat: automatizar lembretes pelo WhatsApp Business"
```

---

### Task 5: Tela, importação e revisão operacional

**Files:**
- Modify: `index.html`
- Modify: `tests/static-regressions.test.cjs`
- Modify: `tests/visual-fixture-server.cjs`

**Interfaces:**
- Consumes: `getLembretesConfig`, `getLembretesEnvios`, `getClientesTelefonePendente`, `saveLembretesConfig`, `testWhatsAppConfig`, `runLembretesNow`.
- Produces: `loadLembretesConfig()`, `saveLembretesConfig()`, `renderLembretesEnvios()`, `normalizarTelefoneImportado()`.

- [ ] **Step 1: Write failing static UI tests**

```js
test('Config possui revisão de mensagens automáticas', () => {
  assert.match(html, /id="cfg-lembrete-ativo"/);
  assert.match(html, /id="cfg-lembrete-modelo"/);
  assert.match(html, /id="cfg-lembrete-preview"/);
  assert.match(html, /id="cfg-whatsapp-token"/);
  assert.match(html, /Últimos envios/);
});

test('importação compara telefone canônico', () => {
  assert.match(html, /normalizarTelefoneImportado\(telRaw\)/);
  assert.doesNotMatch(html, /const telDigitos = telRaw\.replace/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/static-regressions.test.cjs --test-name-pattern="mensagens automáticas|telefone canônico"`  
Expected: FAIL because controls and canonical import are absent.

- [ ] **Step 3: Add responsive Config section**

Add activation, 3/4-hour selector, textarea, live preview, variables help, Meta fields, masked token status, save/test/process buttons, integration status, recent history and invalid-phone list. Use existing `.cfg-sec`, `.form-row`, `safe()` and `attr()` patterns.

- [ ] **Step 4: Normalize import and duplicate matching**

Canonicalize both stored and imported numbers; send the canonical display value to `saveCliente`; treat equal canonical values as duplicates even if punctuation or duplicated country code differs.

- [ ] **Step 5: Refresh all affected pages after linked mutations**

After agenda/caixa save or delete, invalidate both caches and reload Agenda, Caixa and Relacionamento when visible. Update confirmations to explain that linked records and pending reminders are handled together.

- [ ] **Step 6: Extend fixture without external sends**

Return configured-but-disabled sample settings, `enviado`, `erro` and `pendente` rows, plus one invalid phone. Stub write actions with deterministic success and never call Meta.

- [ ] **Step 7: Verify tests and commit**

Run: `npm.cmd test`  
Expected: all tests PASS.

```powershell
git add index.html tests/static-regressions.test.cjs tests/visual-fixture-server.cjs
git commit -m "feat: criar revisão de mensagens automáticas"
```

---

### Task 6: Documentação, visual QA e publicação

**Files:**
- Modify: `README.md`
- Modify: `decisões.md`
- Modify: both plan and spec checkboxes/status only if required by established project convention.

- [ ] **Step 1: Document operation and decisions**

Record the official provider choice, template approval dependency, 4-hour default, opening-time fallback, independent dates, cascade behavior, token storage and activation steps.

- [ ] **Step 2: Run complete automated verification**

Run:

```powershell
npm.cmd test
git diff --check
node --check .tmp-index-check.js
```

Expected: zero failures, zero whitespace errors and valid extracted frontend JavaScript.

- [ ] **Step 3: Run visual fixture QA**

Validate desktop and 390×844: no page-level horizontal overflow, controls labeled, live preview updates, token never rendered, history readable, invalid phone edit action usable, and linked deletion text clear.

- [ ] **Step 4: Review implementation against this specification**

Confirm each of the 12 acceptance criteria in the design has direct automated or visual evidence.

- [ ] **Step 5: Merge locally after verification**

Fast-forward `main` from `feature/sync-reminders`, rerun the complete test suite from the main checkout and confirm a clean status.

- [ ] **Step 6: Publish backend and install trigger**

Run `clasp status`, `clasp push`, deploy a new version preserving the existing deployment ID, then invoke the trigger setup function. Confirm the deployed web app answers HTTP 200 and that `getLembretesConfig` never returns the access token.

- [ ] **Step 7: Push GitHub and deploy frontend**

Push `main`, wait for Vercel production to become Ready and verify the public alias contains “Mensagens automáticas”, “DRE anual” and “Central de Relacionamento”.

- [ ] **Step 8: Final evidence**

Report test count, commit hash, Apps Script version, trigger state, Vercel deployment, access link and any external Meta credential/template dependency that remains inactive.
