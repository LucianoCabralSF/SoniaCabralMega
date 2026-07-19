# Sonia Cabral Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir integralmente as falhas confirmadas de segurança, finanças, planejamento, datas, cache e acessibilidade sem acessar dados reais nem substituir a infraestrutura atual.

**Architecture:** Manter `index.html` + Vercel e Google Apps Script + Sheets. Extrair regras puras para `rules.js` e `Regras.gs`, testadas pelo runner nativo do Node; aplicar validação e escape nos limites do sistema e preservar compatibilidade por migração automática da senha legada.

**Tech Stack:** HTML/CSS/JavaScript sem framework, Google Apps Script V8, Google Sheets, Vercel, Node.js `node:test`.

## Global Constraints

- Não acessar nem gravar a planilha real durante implementação ou testes.
- Não adicionar dependências de runtime ou de teste.
- Preservar URLs, schemas existentes e compatibilidade dos registros atuais.
- Calcular dinheiro crítico em centavos inteiros.
- Tratar todo texto de formulário, planilha e API como não confiável.
- Registrar decisões e riscos em `decisões.md`.

---

### Task 1: Harness de testes e regras puras

**Files:**
- Create: `package.json`
- Create: `rules.js`
- Create: `Regras.gs`
- Create: `tests/rules.test.cjs`
- Create: `tests/static-regressions.test.cjs`

**Interfaces:**
- Produces frontend `window.SoniaRules` / CommonJS com `parseDate`, `isValidIsoDate`, `addMonthsClamped`, `splitMoney`, `validatePayment`, `escapeHtml`, `escapeAttr` e `makeIdempotencyKey`.
- Produces backend global functions `validarDataISO_`, `dataMensalLimitada_`, `dividirCentavos_`, `validarPagamento_`, `paraCentavos_` e `deCentavos_`.

- [ ] **Step 1: Write failing rule tests**

```js
test('31 de janeiro mais um mês termina em fevereiro', () => {
  assert.equal(rules.addMonthsClamped('2026-01-31', 1, 31), '2026-02-28');
});

test('parcelas somam exatamente o total em centavos', () => {
  assert.deepEqual(rules.splitMoney(10000, 3), [3334, 3333, 3333]);
});

test('pagamento acima do saldo é rejeitado', () => {
  assert.equal(rules.validatePayment({ paymentCents: 15000, balanceCents: 10000 }).ok, false);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because `rules.js` and `Regras.gs` do not exist.

- [ ] **Step 3: Implement pure rule modules**

```js
function splitMoney(totalCents, count) {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('Total inválido.');
  if (!Number.isInteger(count) || count < 1) throw new Error('Número de parcelas inválido.');
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all rule tests PASS; static regression tests still fail on current production code.

- [ ] **Step 5: Commit**

```bash
git add package.json rules.js Regras.gs tests
git commit -m "test: adicionar regras financeiras e de datas"
```

### Task 2: Autenticação e sessão seguras

**Files:**
- Modify: `Código.gs`
- Modify: `index.html`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- `authLogic(senha, lembrar)` returns `{ token, longToken?, salonName }`.
- `getPublicConfig_()` never returns `senha`, `senhaHash`, `senhaSalt` or `tokenTTL`.
- `updatePassword_(token, atual, nova)` revokes all existing sessions.
- `logoutToken_(token)` removes cache/property records for that token.

- [ ] **Step 1: Add failing auth regression tests**

```js
test('frontend envia login somente por POST e respeita lembrar', () => {
  assert.match(html, /post\(\{\s*action:'login',\s*senha,\s*lembrar/);
  assert.doesNotMatch(html, /api\(\{\s*action:'login'/);
});

test('configuração pública não devolve senha', () => {
  assert.match(backend, /function getPublicConfig_\(/);
  assert.match(backend, /case 'getConfig':\s+return ok\(getPublicConfig_\(\)\)/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/static-regressions.test.cjs`

Expected: failures for GET login, missing sanitized config, ignored checkbox and missing password migration.

- [ ] **Step 3: Implement hash migration, versioned tokens and rate limiting**

```js
function getAuthVersion_() {
  return parseInt(SCRIPT_PROPS.getProperty('auth_version') || '1', 10);
}

function getPublicConfig_() {
  const cfg = getConfigObj();
  return {
    salonName: cfg.salonName || 'Sonia Cabral',
    horaInicio: cfg.horaInicio || '08:00',
    horaFim: cfg.horaFim || '18:00',
    intervaloMin: cfg.intervaloMin || '30'
  };
}
```

- [ ] **Step 4: Implement frontend persistence semantics**

```js
const lembrar = !!qs('#chk-lembrar')?.checked;
const r = await post({ action:'login', senha, lembrar });
if (lembrar && r.data.longToken) localStorage.setItem('sc_ltok', JSON.stringify(r.data.longToken));
else sessionStorage.setItem('sc_tok', JSON.stringify(r.data.token));
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test`

Expected: auth/static tests PASS.

- [ ] **Step 6: Commit**

```bash
git add Código.gs index.html tests/static-regressions.test.cjs
git commit -m "fix: proteger senha e sessões"
```

### Task 3: Integridade de fiado e pagamentos

**Files:**
- Modify: `Código.gs`
- Modify: `index.html`
- Modify: `tests/rules.test.cjs`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- `saveLancamentoFiado(d)` stores exact per-installment values from `dividirCentavos_`.
- `pagarCrediario(b)` requires `idempotencyKey`, rejects overpayment and validates selected installment amount.

- [ ] **Step 1: Add failing financial tests**

```js
test('parcela selecionada exige o valor integral', () => {
  const result = rules.validatePayment({ paymentCents: 100, balanceCents: 10000, installmentCents: 3333 });
  assert.equal(result.code, 'installment_mismatch');
});

test('pagamento parcial sem parcela continua permitido', () => {
  assert.equal(rules.validatePayment({ paymentCents: 100, balanceCents: 10000 }).ok, true);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/rules.test.cjs tests/static-regressions.test.cjs`

Expected: missing exact installment distribution and idempotency checks.

- [ ] **Step 3: Implement exact cents and backend validation**

```js
const saldoCentavos = paraCentavos_(valorTotal) - paraCentavos_(entradaValor);
const parcelasCentavos = dividirCentavos_(saldoCentavos, numParcelas);
// Each movement stores deCentavos_(parcelasCentavos[i]).
```

- [ ] **Step 4: Add one idempotency key per UI submission**

```js
state.ui.paymentKey = SoniaRules.makeIdempotencyKey('cred');
// Send the same key while the modal remains open; create a new key only for a new modal.
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test`

Expected: all financial and static tests PASS.

- [ ] **Step 6: Commit**

```bash
git add Código.gs index.html tests
git commit -m "fix: garantir integridade de pagamentos fiados"
```

### Task 4: Planejamento, datas, IDs e cache

**Files:**
- Modify: `Código.gs`
- Modify: `index.html`
- Modify: `tests/rules.test.cjs`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- `savePlanejamento(d)` creates or edits; structural edit is rejected only if paid installments exist.
- `deletePlanejamento_(id)` soft-deletes plan and open installments only when no paid installments exist.
- `upsertByIdUnlocked_` rejects unknown/deleted edit IDs.
- `loadAll()` persists cache only after all core reads succeed.

- [ ] **Step 1: Add failing planning/cache tests**

```js
test('backend possui rota de exclusão de planejamento', () => {
  assert.match(backend, /case 'deletePlanejamento'/);
});

test('timeout não usa status confundido com resposta válida', () => {
  assert.match(html, /status:'network_error'/);
  assert.doesNotMatch(html, /catch\(\(\) => \(\{ status:'err' \}\)\)/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/static-regressions.test.cjs`

Expected: edit rejection, missing delete route and `status:'err'` mismatch.

- [ ] **Step 3: Implement planning edit/delete and clamped dates**

```js
const vencimento = dataMensalLimitada_(dataInicio, i, diaVencimento);
// When editing, reject if paid rows exist; otherwise soft-delete prior open rows and regenerate.
```

- [ ] **Step 4: Reject stale edit IDs**

```js
if (record.id && !existingRow) return { error: 'Registro não encontrado ou desatualizado.' };
```

- [ ] **Step 5: Correct cache success gate and surface sync state**

```js
const coreOk = [cli, svc, prd, col, cred, plan, planParc].every(response => response.status === 'ok');
if (!coreOk) throw new Error('Falha ao sincronizar dados principais.');
saveDbCache();
```

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm test`

Expected: date, planning, ID and cache tests PASS.

- [ ] **Step 7: Commit**

```bash
git add Código.gs index.html tests
git commit -m "fix: corrigir planejamento datas e cache"
```

### Task 5: XSS e limites de dados não confiáveis

**Files:**
- Modify: `index.html`
- Modify: `vercel.json`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- All interpolated API/form strings use `SoniaRules.escapeHtml` for text and `SoniaRules.escapeAttr` for attributes.
- Dynamic IDs passed to handlers use escaped attributes or `data-*` delegation.

- [ ] **Step 1: Add failing injection tests**

```js
test('escapeHtml neutraliza marcação executável', () => {
  assert.equal(rules.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('renderizações críticas escapam dados', () => {
  for (const token of ['c.nome', 's.nome', 'p.nome', 'ag.clienteNome', 'p.descricao']) {
    assert.equal(findUnsafeInterpolation(html, token), false);
  }
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/rules.test.cjs tests/static-regressions.test.cjs`

Expected: unsafe interpolation findings.

- [ ] **Step 3: Escape every dynamic render path and add headers**

```js
const safe = SoniaRules.escapeHtml;
const attr = SoniaRules.escapeAttr;
// Example: `<div class="cname">${safe(c.nome || '—')}</div>`
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: injection and static tests PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html vercel.json rules.js tests
git commit -m "fix: neutralizar conteúdo não confiável"
```

### Task 6: Acessibilidade, UX e PWA

**Files:**
- Modify: `index.html`
- Modify: `sw.js`
- Modify: `manifest.json`
- Modify: `tests/static-regressions.test.cjs`

**Interfaces:**
- `ensureAccessibleControls(root)` associates `.lbl` text with controls and applies dialog semantics.
- `setSyncStatus(kind, message)` exposes visible and live-region state.
- Service worker cache name increments and caches only successful responses.

- [ ] **Step 1: Add failing accessibility/PWA tests**

```js
test('viewport permite zoom', () => assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/));
test('toast é live region', () => assert.match(html, /id="toast"[^>]+aria-live="polite"/));
test('service worker não armazena respostas com erro', () => assert.match(sw, /if\s*\(res\.ok\)/));
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/static-regressions.test.cjs`

Expected: viewport, live region, focus and service-worker failures.

- [ ] **Step 3: Implement accessibility and UX refinements**

```css
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible {
  outline:3px solid #1877f2;
  outline-offset:2px;
}
```

- [ ] **Step 4: Harden service worker fallback**

```js
if (res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
// On failure: cached response; index only for req.mode === 'navigate'; otherwise 503.
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test`

Expected: all accessibility/PWA tests PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js manifest.json tests
git commit -m "fix: melhorar acessibilidade e modo offline"
```

### Task 7: Verificação integrada e documentação

**Files:**
- Modify: `README.md`
- Modify: `decisões.md`
- Modify: `docs/superpowers/plans/2026-07-19-hardening-implementation.md`

**Interfaces:**
- `npm test` is the single local regression command.
- Browser audit server uses simulated data only.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: zero failures and zero unexpected warnings.

- [ ] **Step 2: Run syntax validation**

Run: parse both inline scripts from `index.html` with `new Function`, parse `rules.js`, `Regras.gs` and `Código.gs` with `new Function`.

Expected: all scripts report `syntax OK`.

- [ ] **Step 3: Run local browser audit with mocked API**

Validate login semantics, dashboard, Caixa, Agenda day/week/month, Clientes, Fiado, Planning edit/delete, Config password flow, 390×844 layout, keyboard focus and console logs.

Expected: no uncaught errors, no horizontal overflow in primary views, correct accessible names and error messages.

- [ ] **Step 4: Update documentation**

Document `npm test`, password migration, initial-password setup, deploy order (`clasp` backend before Vercel frontend) and rollback notes.

- [ ] **Step 5: Verify repository diff and commit**

```bash
git diff --check
git status --short
git add README.md decisões.md docs/superpowers/plans/2026-07-19-hardening-implementation.md
git commit -m "docs: concluir guia de correções e validação"
```
