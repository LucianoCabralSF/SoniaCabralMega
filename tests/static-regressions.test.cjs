const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'Código.gs'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const visualFixture = fs.readFileSync(path.join(root, 'tests', 'visual-fixture-server.cjs'), 'utf8');
const claspIgnore = fs.readFileSync(path.join(root, '.claspignore'), 'utf8');

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

test('failed logins are serialized and throttled after the limit', () => {
  assert.match(backend, /LockService\.getScriptLock\(\)/);
  assert.match(backend, /Utilities\.sleep\(1200\)/);
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
  assert.match(backend, /setPasswordHash_\(String\(password\), true\)/);
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
  assert.match(backend, /function saveAgendamento\(d\)[\s\S]{0,900}currentStatus/);
  assert.match(backend, /function concluirAgendamentoComCaixa_\(b\)[\s\S]{0,3500}currentStatus !== 'agendado'/);
  assert.match(html, /ag\.status === 'concluido' \? 'disabled'/);
});

test('appointment and cash deletions use the linked cascade routes', () => {
  assert.match(backend, /case 'deleteAgendamento':\s+return result\(deleteAgendamentoVinculado_\(b\.id\)\)/);
  assert.match(backend, /case 'deleteLancamento':\s+return result\(deleteLancamento_\(b\.id\)\)/);
  assert.match(backend, /function deleteLancamento_\([\s\S]{0,900}deleteAgendamentoVinculadoUnlocked_/);
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
  assert.match(backend, /function cleanId_\(/);
  assert.match(backend, /h === 'id' \|\| \/Id\$\//);
  assert.match(backend, /const idx = Object\.create\(null\)/);
  assert.match(backend, /setValue\(cleanText_\(b\.observacoes, 1000\)\)/);
});

test('cache invalidation cannot turn a completed sheet write into a failure', () => {
  assert.match(backend, /function invalidateSheetCache_\(sheetName\)[\s\S]{0,400}try \{ CACHE\.remove/);
  assert.match(backend, /function invalidateCaixaCaches_\(data\)[\s\S]{0,220}try \{ CACHE\.remove/);
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
  assert.match(html, /<label class="lbl" for="inp-senha">Senha<\/label>/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /setAttribute\('aria-pressed', 'false'\)/);
  assert.match(html, /<button type="button" class="gcal-event"/);
  assert.match(html, /<button type="button" onclick="addItemDireto\(this\)"/);
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

test('Apps Script deployment includes the shared backend rules', () => {
  assert.match(claspIgnore, /^!Regras\.gs$/m);
  assert.match(claspIgnore, /^!LembreteRegras\.gs$/m);
  assert.match(readme, /Sempre publique o backend antes do frontend/);
  assert.match(readme, /reverta primeiro a Vercel[\s\S]*versão anterior do Web App/);
});

test('configuração permite revisar e operar lembretes automáticos', () => {
  for (const id of [
    'cfg-lembrete-ativo','cfg-lembrete-horas','cfg-lembrete-modelo',
    'cfg-lembrete-preview','cfg-whatsapp-token','cfg-lembrete-envios',
    'cfg-telefones-pendentes'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /function loadLembretesConfig\(/);
  assert.match(html, /function saveLembretesConfig\(/);
  assert.match(html, /action:'testWhatsAppConfig'/);
  assert.match(html, /action:'runLembretesNow'/);
  assert.match(html, /#page-config > \.ph,#page-config > \.cfg-sec\{max-width:820px/);
});

test('importação remove o 55 duplicado antes de salvar e comparar', () => {
  assert.match(html, /function normalizarTelefoneImportado\(/);
  assert.match(html, /const telefone = normalizarTelefoneImportado\(telRaw\)/);
  assert.match(html, /normalizarTelefoneImportado\(c\.telefone \|\| ''\)/);
  assert.doesNotMatch(html, /const telDigitos = telRaw\.replace\(\/\\D\/g, ''\)/);
  assert.match(html, /fillClienteFieldsFromContact[\s\S]{0,500}normalizarTelefoneImportado\(telRaw\)/);
});

test('telas refletem a cascata entre agenda, caixa e relacionamento', () => {
  assert.match(html, /delAgend[\s\S]{0,900}loadCaixa\(true\)/);
  assert.match(html, /delAgend[\s\S]{0,900}loadRelacionamento\(\)/);
  assert.match(html, /delLanc[\s\S]{0,1200}loadAgenda\(true\)/);
  assert.match(html, /delLanc[\s\S]{0,1200}loadRelacionamento\(\)/);
  assert.doesNotMatch(html, /O lançamento financeiro existente, se houver, não será apagado/);
  assert.doesNotMatch(html, /O registro de origem \(agenda, fiado ou planejamento\) não será alterado/);
});

test('Central de Relacionamento tem navegação, filtros e resumo', () => {
  assert.match(html, /data-go="relacionamento"/);
  assert.match(html, /id="page-relacionamento"/);
  assert.match(html, /function loadRelacionamento\(/);
  assert.match(html, /function renderRelacionamento\(/);
  assert.match(html, /id="rel-fila"/);
  assert.match(html, /id="rel-etapa"/);
  assert.match(html, /relacionamentoResumo/);
});

test('WhatsApp assistido só registra depois da confirmação humana', () => {
  assert.match(html, /https:\/\/wa\.me\//);
  assert.match(html, /function abrirWhatsAppRelacionamento\(/);
  assert.match(html, /function confirmarContatoRelacionamento\(/);
  assert.match(html, /Confirma que a mensagem foi enviada/);
  assert.match(html, /action:'confirmarContato'/);
});

test('conclusão envia próximo retorno ou escolha explícita sem retorno', () => {
  assert.match(html, /id="ag-retorno-data"/);
  assert.match(html, /id="ag-sem-retorno"/);
  assert.match(html, /returnRecommendation:/);
  assert.match(html, /semRetorno:/);
});

test('campanhas usam público explícito filtrado no frontend', () => {
  assert.match(html, /function abrirCampanhaRelacionamento\(/);
  assert.match(html, /function filtrarPublicoCampanha\(/);
  assert.match(html, /optedOut \|\| !\/\^55\\d\{10,11\}\$\//);
  assert.match(html, /action:'saveCampanha'/);
  assert.match(html, /action:'generateCampanha'/);
  assert.match(html, /clienteIds:/);
});

test('gaveta mantém largura confortável em telas grandes', () => {
  assert.match(html, /#drawer\{[\s\S]*?width:min\(720px,100%\);margin:0 auto;/);
});

test('fixture visual cobre filas, histórico e campanhas', () => {
  for (const action of [
    'getRelacionamento','getRelacionamentoResumo','getRelacionamentoEventos','getCampanhas'
  ]) {
    assert.match(visualFixture, new RegExp(action));
  }
  assert.match(visualFixture, /telefoneValido:\s*false/);
  assert.match(visualFixture, /fila:\s*'recuperacao'/);
  assert.match(visualFixture, /fila:\s*'aniversario'/);
  assert.match(visualFixture, /fila:\s*'campanha'/);
});

test('DRE anual possui navegação, seletor, tabela e aviso provisório', () => {
  assert.match(html, /data-view="dre-anual"/);
  assert.match(html, /id="view-dre-anual"/);
  assert.match(html, /id="dre-ano"/);
  assert.match(html, /DRE provisória/);
  assert.match(html, /function loadDreAnual\(/);
  assert.match(html, /function renderDreAnual\(/);
});

test('detalhe e classificação da DRE usam rotas dedicadas', () => {
  assert.match(html, /action:'getDreDetalhe'/);
  assert.match(html, /action:'saveDreClassificacao'/);
  assert.match(html, /action:'saveDreMapeamento'/);
  assert.match(html, /function abrirDetalheDre\(/);
  assert.match(html, /function salvarClassificacaoDre\(/);
});

test('DRE usa gráfico local e tabela navegável sem dependência externa', () => {
  assert.match(html, /function renderDreChart\(/);
  assert.match(html, /class="dre-scroll"/);
  assert.match(html, /data-dre-line=/);
  assert.doesNotMatch(html, /cdn[^\n]*chart|Chart\.js/i);
});

test('gaveta fechada não permanece exposta para tecnologia assistiva', () => {
  assert.match(html, /id="drawer" aria-hidden="true"/);
  assert.match(html, /drawer\.setAttribute\('aria-hidden','false'\)/);
  assert.match(html, /drawer\.setAttribute\('aria-hidden','true'\)/);
});

test('fixture visual cobre relatório, detalhe e reclassificação da DRE', () => {
  for (const action of ['getDreAnual','getDreDetalhe','getDreMapeamentos','saveDreClassificacao','saveDreMapeamento']) {
    assert.match(visualFixture, new RegExp(action));
  }
});
