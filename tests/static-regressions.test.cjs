const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'Código.gs'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const visualFixture = fs.readFileSync(path.join(root, 'tests', 'visual-fixture-server.cjs'), 'utf8');

test('frontend and backend scripts keep valid JavaScript syntax', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach(source => assert.doesNotThrow(() => new Function(source)));
  assert.doesNotThrow(() => new Function(backend));
  assert.doesNotThrow(() => new Function(worker));
  assert.doesNotThrow(() => new Function(visualFixture));
  assert.doesNotThrow(() => JSON.parse(vercel));
});

test('login uses POST and sends remember choice', () => {
  assert.match(html, /post\(\{\s*action:'login',\s*senha,\s*lembrar\s*\}\)/);
  assert.doesNotMatch(html, /api\(\{\s*action:'login'/);
});

test('authenticated reads use POST so session tokens stay out of URLs', () => {
  assert.match(html, /function api\(params\)\{\s*return post\(\{ \.\.\.\(params \|\| \{\}\), readOnly:true \}\);\s*\}/);
  assert.match(backend, /function readAction_\(/);
  assert.match(backend, /if \(b\.readOnly === true\) return readAction_\(a, \{ parameter: b \}\);/);
  assert.match(backend, /function doPost\(e\) \{[\s\S]{0,100}ensureSheetsOnce_\(\);/);
});

test('public config never returns or locally caches the password', () => {
  assert.match(backend, /function getPublicConfig_\(/);
  assert.match(backend, /case 'getConfig':\s+return ok\(getPublicConfig_\(\)\)/);
  assert.doesNotMatch(html, /config:\s+state\.db\.config/);
});

test('password changes use a dedicated endpoint and revoke sessions', () => {
  assert.match(backend, /case 'updatePassword'/);
  assert.match(backend, /function revokeAllTokens_\(/);
  assert.doesNotMatch(html, /config:\s*\{\s*senha:/);
});

test('remembered login uses the revocable persistent token as the active session', () => {
  assert.match(backend, /const wantsLongSession =/);
  assert.match(backend, /token = longToken;/);
  assert.match(backend, /SCRIPT_PROPS\.deleteProperty\('ltok_' \+ token\)/);
});

test('timeout status cannot be mistaken for a valid API response', () => {
  assert.match(html, /status:'network_error'/);
  assert.doesNotMatch(html, /status:'err'/);
  assert.match(html, /coreOk/);
});

test('planning supports update and explicit deletion', () => {
  assert.doesNotMatch(backend, /Edição de planejamento existente não suportada/);
  assert.match(backend, /function deletePlanejamento_\(/);
  assert.match(backend, /case 'deletePlanejamento'/);
  assert.match(html, /btn-del-plan/);
});

test('payment submissions contain an idempotency key', () => {
  assert.match(html, /idempotencyKey/);
  assert.match(backend, /idempotencyKey/);
  assert.match(backend, /findCashByItemId_/);
});

test('appointment completion and cash entry share one locked backend operation', () => {
  assert.match(backend, /case 'completeAppointment'/);
  assert.match(backend, /function concluirAgendamentoComCaixa_\(/);
  assert.match(backend, /const lock = LockService\.getDocumentLock\(\)/);
  assert.match(html, /action:'completeAppointment'/);
});

test('appointment and cash deletions use their explicit soft-delete routes', () => {
  assert.match(backend, /case 'deleteAgendamento':\s+return result\(softDelete_\('agendamentos', b\.id\)\)/);
  assert.match(backend, /case 'deleteLancamento':\s+return result\(deleteLancamento_\(b\.id\)\)/);
  assert.match(backend, /function deleteLancamento_\(/);
});

test('planning installment rollback includes a failed cash write', () => {
  assert.match(backend, /const cashResult = saveLancamentoUnlocked_\(/);
  assert.match(backend, /if \(cashResult\.error\) throw new Error\(cashResult\.error\);/);
});

test('stale edit identifiers are rejected instead of creating duplicates', () => {
  assert.match(backend, /if \(record\.id && !existingRow\) \{\s*return \{ error:/);
  assert.match(backend, /if \(currentList && deletedIndex >= 0 && currentList\[deletedIndex\]\) \{\s*return \{ error:/);
});

test('critical render paths escape API text', () => {
  assert.doesNotMatch(html, /<div class="cname">\$\{c\.nome \|\| '—'\}<\/div>/);
  assert.doesNotMatch(html, /<div class="cname">\$\{s\.nome\}<\/div>/);
  assert.doesNotMatch(html, /<div class="ag-cli">\$\{ag\.clienteNome \|\| '—'\}<\/div>/);
  assert.match(html, /const safe\s*=\s*SoniaRules\.escapeHtml/);
  assert.doesNotMatch(html, /value="\$\{ag\.(?:servicos|observacoes) \|\| ''\}"/);
  assert.doesNotMatch(html, />\$\{ag\.clienteNome \|\|/);
});

test('backend neutralizes spreadsheet formulas in user-controlled text', () => {
  assert.match(backend, /return \/\^\[=\+\\-@\]\//);
  assert.match(backend, /'\\u200B' \+ text/);
});

test('viewport, live regions and icon controls are accessible', () => {
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="btn-logout"[^>]*aria-label="Sair"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /function ensureAccessibleControls\(/);
  assert.match(html, /aria-label="Novo planejamento"/);
  assert.match(html, /function keepFocusInsideDialog\(/);
  assert.match(html, /setAttribute\('aria-label'/);
});

test('projected result is labelled accurately', () => {
  assert.match(html, /Resultado projetado/);
  assert.doesNotMatch(html, />Resultado Operacional</);
});

test('service worker caches only successful responses and uses navigation fallback', () => {
  assert.match(worker, /if\s*\(res\.ok\)/);
  assert.match(worker, /req\.mode\s*===\s*'navigate'/);
  assert.match(worker, /status:\s*503/);
});

test('security headers include a content security policy', () => {
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /Strict-Transport-Security/);
  assert.match(vercel, /Permissions-Policy/);
});
