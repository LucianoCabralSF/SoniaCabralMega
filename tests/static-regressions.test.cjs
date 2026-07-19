const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'Código.gs'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

test('frontend and backend scripts keep valid JavaScript syntax', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach(source => assert.doesNotThrow(() => new Function(source)));
  assert.doesNotThrow(() => new Function(backend));
});

test('login uses POST and sends remember choice', () => {
  assert.match(html, /post\(\{\s*action:'login',\s*senha,\s*lembrar\s*\}\)/);
  assert.doesNotMatch(html, /api\(\{\s*action:'login'/);
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

test('critical render paths escape API text', () => {
  assert.doesNotMatch(html, /<div class="cname">\$\{c\.nome \|\| '—'\}<\/div>/);
  assert.doesNotMatch(html, /<div class="cname">\$\{s\.nome\}<\/div>/);
  assert.doesNotMatch(html, /<div class="ag-cli">\$\{ag\.clienteNome \|\| '—'\}<\/div>/);
  assert.match(html, /const safe\s*=\s*SoniaRules\.escapeHtml/);
});

test('viewport, live regions and icon controls are accessible', () => {
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="btn-logout"[^>]*aria-label="Sair"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /function ensureAccessibleControls\(/);
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
