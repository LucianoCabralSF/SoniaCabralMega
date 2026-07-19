// ============================================================
// SONIA CABRAL — Google Apps Script OTIMIZADO (v2)
// Substitui o backend anterior após a migração da planilha
// ============================================================

// ── Constantes ────────────────────────────────────────────────
const CACHE = CacheService.getScriptCache();
const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const LOGIN_FAILURE_KEY = 'auth_login_failures';
const PASSWORD_HASH_KEY = 'auth_password_hash';
const PASSWORD_SALT_KEY = 'auth_password_salt';
const AUTH_VERSION_KEY = 'auth_version';

const SCHEMAS = {
  config: [
    'chave','valor'
  ],
  colaboradores: [
    'id','nome','cargo','telefone','horaInicio','horaFim','ativo','criadoEm','atualizadoEm','deletadoEm'
  ],
  servicos: [
    'id','nome','descricao','duracaoMin','ativo','criadoEm','atualizadoEm','deletadoEm'
  ],
  produtos: [
    'id','nome','preco','descricao','ativo','criadoEm','atualizadoEm','deletadoEm'
  ],
  clientes: [
    'id','nome','telefone','email','aniversario','observacoes','criadoEm','atualizadoEm','deletadoEm'
  ],
  agendamentos: [
    'id','data','hora','duracaoMin','clienteId','clienteNome','colaboradorId',
    'colaboradorNome','servicos','valor','status','observacoes','criadoEm','atualizadoEm','deletadoEm'
  ],
  caixa: [
    'id','data','tipo','categoria','clienteId','clienteNome',
    'itemId','itemNome','itemTipo','valor','formaPagamento',
    'observacoes','isRetirada','criadoEm','atualizadoEm','deletadoEm'
  ],
  crediario: [
    'id','clienteId','clienteNome','tipo','valorTotal','valorEntrada',
    'saldoDevedor','numParcelas','valorParcela','status','observacoes','criadoEm','atualizadoEm','deletadoEm'
  ],
  crediario_mov: [
    'id','crediarioId','clienteId','clienteNome','tipo','valor',
    'numParcela','vencimento','status','observacoes','criadoEm','atualizadoEm','deletadoEm'
  ],
  planejamento: [
    'id','tipo','descricao','valorTotal','numParcelas','valorParcela',
    'diaVencimento','dataInicio','status','observacoes','criadoEm','atualizadoEm','deletadoEm'
  ],
  plan_parcelas: [
    'id','planejamentoId','descricao','tipo','valor','vencimento',
    'status','pago','dataPagamento','observacoes','criadoEm','atualizadoEm','deletadoEm'
  ]
};

// ── Output helpers ────────────────────────────────────────────
function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ok(data) { return out({ status: 'ok', data: data }); }
function err(msg) { return out({ status: 'error', data: { message: msg } }); }
function doOptions() { return out(''); }
function result(res) { return res && res.error ? err(res.error) : ok(res); }

// ── Utils ─────────────────────────────────────────────────────
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz() { return Session.getScriptTimeZone(); }
function now() { return new Date(); }
function nowIso() { return Utilities.formatDate(now(), tz(), "yyyy-MM-dd'T'HH:mm:ss"); }
function today() { return Utilities.formatDate(now(), tz(), 'yyyy-MM-dd'); }
function uid(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

function normalizeBoolStr(v, fallback) {
  if (v === true || String(v).toLowerCase() === 'true') return 'true';
  if (v === false || String(v).toLowerCase() === 'false') return 'false';
  return fallback || 'false';
}

function normalizeNumber(v) {
  if (v === null || v === '' || typeof v === 'undefined') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function normDate(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, a] = s.split('/');
    return `${a}-${m}-${d}`;
  }
  try {
    return Utilities.formatDate(new Date(v), tz(), 'yyyy-MM-dd');
  } catch (_) {
    return s.slice(0, 10);
  }
}

function toISO(v) {
  if (!v) return today();
  const normalized = normalizarDataEstrita_(v);
  if (!normalized) throw new Error('Data inválida. Use uma data real no formato DD/MM/AAAA.');
  return normalized;
}

function fmtBR(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function getSheet(name) {
  const ss = ss_();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, SCHEMAS[name].length).setValues([SCHEMAS[name]]);
    styleHeader_(s, SCHEMAS[name].length);
  }
  return s;
}

function styleHeader_(sheet, cols) {
  sheet.getRange(1, 1, 1, cols)
    .setFontWeight('bold')
    .setBackground('#1a1a14')
    .setFontColor('#c9a132');
  sheet.setFrozenRows(1);
}

function ensureSheets() {
  Object.keys(SCHEMAS).forEach(name => {
    const s = getSheet(name);
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, SCHEMAS[name].length).setValues([SCHEMAS[name]]);
      styleHeader_(s, SCHEMAS[name].length);
    }
  });

  ensureConfigDefaults_();
}

// Roda a verificação de abas no máximo 1x por período — antes rodava em TODA chamada e deixava tudo lento
function ensureSheetsOnce_() {
  if (CACHE.get('sheets_ok')) return;
  if (SCRIPT_PROPS.getProperty('sheets_ok') === '1') {
    CACHE.put('sheets_ok', '1', 21600);
    return;
  }
  ensureSheets();
  SCRIPT_PROPS.setProperty('sheets_ok', '1');
  CACHE.put('sheets_ok', '1', 21600);
}

function ensureConfigDefaults_() {
  const cfg = getSheet('config');
  const defaults = {
    salonName: 'Sonia Cabral',
    horaInicio: '08:00',
    horaFim: '18:00',
    intervaloMin: '30',
    tokenTTL: '2592000'
  };

  const d = sheetData_('config');
  const keyCol = d.headers.indexOf('chave');
  const existing = {};
  if (keyCol >= 0) {
    d.rows.forEach(r => {
      const key = String(r[keyCol] || '').trim();
      if (key) existing[key] = true;
    });
  }

  const missing = Object.entries(defaults).filter(([key]) => !existing[key]);
  if (missing.length) {
    cfg.getRange(cfg.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
    invalidateSheetCache_('config');
  }
}

// ── Read helpers ──────────────────────────────────────────────
function sheetData_(sheetName) {
  const s = getSheet(sheetName);
  const lastRow = s.getLastRow();
  const lastCol = s.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [], sheet: s };

  const values = s.getRange(1, 1, lastRow, lastCol).getValues();
  return {
    headers: values[0].map(v => String(v || '').trim()),
    rows: values.slice(1),
    sheet: s
  };
}

function objectifyRows_(headers, rows) {
  return rows
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => {
        let v = r[i];
        if (v instanceof Date) {
          v = h === 'hora'
            ? Utilities.formatDate(v, tz(), 'HH:mm')
            : Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
        }
        if (v === true) v = 'true';
        if (v === false) v = 'false';
        o[h] = v;
      });
      return o;
    });
}

function readRows_(sheetName, opts) {
  opts = opts || {};
  const d = sheetData_(sheetName);
  let list = objectifyRows_(d.headers, d.rows);

  if (!opts.includeDeleted && d.headers.indexOf('deletadoEm') >= 0) {
    list = list.filter(x => !x.deletadoEm);
  }
  return list;
}

function buildIdIndex_(sheetName) {
  const cacheKey = 'idx_' + sheetName;
  const cached = CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const s = getSheet(sheetName);
  const lastRow = s.getLastRow();
  const idx = {};

  if (lastRow >= 2) {
    const ids = s.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const duplicados = {};
    ids.forEach((id, i) => {
      if (!id) return;
      const k = String(id);
      if (idx[k] !== undefined) duplicados[k] = true;
      idx[k] = i + 2;
    });
    // id repetido em mais de uma linha: recusar a operação em vez de
    // gravar/pagar silenciosamente na linha errada
    Object.keys(duplicados).forEach(k => { delete idx[k]; });
  }

  CACHE.put(cacheKey, JSON.stringify(idx), 300);
  return idx;
}

function invalidateSheetCache_(sheetName) {
  CACHE.remove('idx_' + sheetName);
  CACHE.remove('rows_' + sheetName);
  CACHE.remove('cfg_obj');
}

function getCachedRows_(sheetName, seconds) {
  const cacheKey = 'rows_' + sheetName;
  const cached = CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const data = readRows_(sheetName);
  try {
    CACHE.put(cacheKey, JSON.stringify(data), seconds || 120);
  } catch (_) {
    // aba grande demais para o cache (limite 100KB) — segue sem cache
  }
  return data;
}

// Localiza a linha de um id com verificação: se o índice estiver desatualizado
// (ex.: linhas movidas/apagadas manualmente na planilha), reconstrói antes de gravar.
function rowNumForId_(sheetName, id) {
  const s = getSheet(sheetName);
  let idx = buildIdIndex_(sheetName);
  let rowNum = idx[String(id)];
  if (rowNum && String(s.getRange(rowNum, 1).getValue()) === String(id)) return rowNum;

  CACHE.remove('idx_' + sheetName);
  idx = buildIdIndex_(sheetName);
  rowNum = idx[String(id)];
  if (rowNum && String(s.getRange(rowNum, 1).getValue()) === String(id)) return rowNum;
  return null;
}

// ── Config ────────────────────────────────────────────────────
function withDocumentLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function getConfigObj() {
  const cached = CACHE.get('cfg_obj');
  if (cached) return JSON.parse(cached);

  const o = {};
  readRows_('config', { includeDeleted: true }).forEach(r => {
    o[r.chave] = r.valor;
  });

  CACHE.put('cfg_obj', JSON.stringify(o), 300);
  return o;
}

function updateConfigValues_(cfg) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const s = getSheet('config');
    const d = sheetData_('config');
    const headers = d.headers;
    const rows = d.rows;

    const keyCol = headers.indexOf('chave');
    const valCol = headers.indexOf('valor');

    Object.entries(cfg || {}).forEach(([k, v]) => {
      let found = false;
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][keyCol]) === String(k)) {
          s.getRange(i + 2, valCol + 1).setValue(v);
          found = true;
          break;
        }
      }
      if (!found) {
        s.appendRow([k, v]);
      }
    });

    invalidateSheetCache_('config');
    return { updated: true };
  } finally {
    lock.releaseLock();
  }
}

function isPaid_(value) {
  const normalized = String(value == null ? '' : value).toLowerCase();
  return value === true || normalized === 'true' || normalized === 'pago';
}

function cleanText_(value, maxLength) {
  let text = String(value == null ? '' : value).replace(/\u0000/g, '').trim();
  const limit = Number.isInteger(maxLength) ? maxLength : 500;
  text = text.slice(0, limit);
  // Impede que texto controlado pelo usuário seja interpretado como fórmula na planilha.
  return /^[=+\-@]/.test(text) ? '\u200B' + text : text;
}

function validTime_(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function updateConfig(cfg) {
  const allowed = ['salonName', 'horaInicio', 'horaFim', 'intervaloMin'];
  const safeConfig = {};
  Object.entries(cfg || {}).forEach(([key, value]) => {
    if (allowed.indexOf(key) >= 0) safeConfig[key] = value;
  });
  if (!Object.keys(safeConfig).length) return { error: 'Nenhuma configuração permitida foi informada.' };
  if (Object.prototype.hasOwnProperty.call(safeConfig, 'salonName')) {
    safeConfig.salonName = cleanText_(safeConfig.salonName, 80);
    if (!safeConfig.salonName) return { error: 'Informe o nome do salão.' };
  }
  if (Object.prototype.hasOwnProperty.call(safeConfig, 'horaInicio') && !validTime_(safeConfig.horaInicio)) return { error: 'Horário inicial inválido.' };
  if (Object.prototype.hasOwnProperty.call(safeConfig, 'horaFim') && !validTime_(safeConfig.horaFim)) return { error: 'Horário final inválido.' };
  if (Object.prototype.hasOwnProperty.call(safeConfig, 'horaInicio') || Object.prototype.hasOwnProperty.call(safeConfig, 'horaFim')) {
    const current = getConfigObj();
    const start = safeConfig.horaInicio || current.horaInicio || '08:00';
    const end = safeConfig.horaFim || current.horaFim || '18:00';
    if (start >= end) return { error: 'O horário final deve ser posterior ao inicial.' };
  }
  if (Object.prototype.hasOwnProperty.call(safeConfig, 'intervaloMin')) {
    const interval = parseInt(safeConfig.intervaloMin, 10);
    if (!Number.isInteger(interval) || interval < 15 || interval > 120) return { error: 'O intervalo deve estar entre 15 e 120 minutos.' };
    safeConfig.intervaloMin = interval;
  }
  return updateConfigValues_(safeConfig);
}

// ── Auth ──────────────────────────────────────────────────────
function limparTokensExpirados_() {
  try {
    const all = SCRIPT_PROPS.getProperties();
    const agora = nowIso();
    Object.keys(all).forEach(k => {
      if (k.indexOf('ltok_') !== 0) return;
      try {
        const o = JSON.parse(all[k]);
        if (!o.expiresAt || o.expiresAt < agora) SCRIPT_PROPS.deleteProperty(k);
      } catch (_) {
        SCRIPT_PROPS.deleteProperty(k);
      }
    });
  } catch (_) {}
}

function bytesToHex_(bytes) {
  return bytes.map(value => {
    const normalized = value < 0 ? value + 256 : value;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

function passwordHash_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || '') + ':' + String(password || ''),
    Utilities.Charset.UTF_8
  );
  return bytesToHex_(bytes);
}

function constantTimeEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  }
  return difference === 0;
}

function setPasswordHash_(password) {
  const value = String(password || '');
  if (value.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
  const salt = Utilities.getUuid().replace(/-/g, '');
  SCRIPT_PROPS.setProperties({
    [PASSWORD_SALT_KEY]: salt,
    [PASSWORD_HASH_KEY]: passwordHash_(value, salt)
  });
}

function verifyPassword_(password, migrateLegacy) {
  const salt = SCRIPT_PROPS.getProperty(PASSWORD_SALT_KEY);
  const storedHash = SCRIPT_PROPS.getProperty(PASSWORD_HASH_KEY);
  if (salt && storedHash) return constantTimeEqual_(storedHash, passwordHash_(password, salt));

  const cfg = getConfigObj();
  const legacy = String(cfg.senha || '');
  const validLegacy = !!legacy && constantTimeEqual_(legacy, String(password || ''));
  if (validLegacy && migrateLegacy !== false) {
    setPasswordHash_(String(password));
    updateConfigValues_({ senha: '' });
  }
  return validLegacy;
}

function getAuthVersion_() {
  return Math.max(1, parseInt(SCRIPT_PROPS.getProperty(AUTH_VERSION_KEY) || '1', 10) || 1);
}

function revokeAllTokens_() {
  const nextVersion = getAuthVersion_() + 1;
  SCRIPT_PROPS.setProperty(AUTH_VERSION_KEY, String(nextVersion));
  const all = SCRIPT_PROPS.getProperties();
  Object.keys(all).forEach(key => {
    if (key.indexOf('ltok_') === 0) SCRIPT_PROPS.deleteProperty(key);
  });
  return nextVersion;
}

function logoutToken_(token) {
  if (!token) return { loggedOut: true };
  CACHE.remove('tok_' + token);
  SCRIPT_PROPS.deleteProperty('ltok_' + token);
  return { loggedOut: true };
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

function getLoginFailures_() {
  try { return JSON.parse(CACHE.get(LOGIN_FAILURE_KEY) || '{"count":0}'); }
  catch (_) { return { count: 0 }; }
}

function registerLoginFailure_() {
  const current = getLoginFailures_();
  const count = (parseInt(current.count, 10) || 0) + 1;
  CACHE.put(LOGIN_FAILURE_KEY, JSON.stringify({ count: count }), 300);
  return count;
}

function authLogic(senha, lembrar) {
  const failures = getLoginFailures_();
  if ((failures.count || 0) >= 5) return err('Muitas tentativas incorretas. Aguarde 5 minutos.');
  if (!verifyPassword_(senha, true)) {
    registerLoginFailure_();
    return err('Senha incorreta.');
  }
  CACHE.remove(LOGIN_FAILURE_KEY);

  limparTokensExpirados_();

  const authVersion = getAuthVersion_();
  const wantsLongSession = lembrar === true || String(lembrar) === 'true';
  let token = '';
  let longToken = '';
  if (wantsLongSession) {
    const cfg = getConfigObj();
    longToken = Utilities.getUuid();
    const ttl = Math.min(2592000, Math.max(3600, parseInt(cfg.tokenTTL || '2592000', 10) || 2592000));
    SCRIPT_PROPS.setProperty('ltok_' + longToken, JSON.stringify({
      createdAt: nowIso(),
      expiresAt: Utilities.formatDate(new Date(Date.now() + ttl * 1000), tz(), "yyyy-MM-dd'T'HH:mm:ss"),
      version: authVersion
    }));
    token = longToken;
  } else {
    token = Utilities.getUuid();
    CACHE.put('tok_' + token, JSON.stringify({ version: authVersion }), 3600);
  }

  return ok({
    token: token,
    longToken: longToken,
    salonName: getPublicConfig_().salonName
  });
}

function validateToken(t) {
  if (!t) return false;
  const currentVersion = getAuthVersion_();
  const cachedToken = CACHE.get('tok_' + t);
  if (cachedToken) {
    if (cachedToken === '1' && currentVersion === 1) return true;
    try {
      if (parseInt(JSON.parse(cachedToken).version, 10) === currentVersion) return true;
    } catch (_) {}
  }

  const raw = SCRIPT_PROPS.getProperty('ltok_' + t);
  if (!raw) return false;

  try {
    const obj = JSON.parse(raw);
    const tokenVersion = parseInt(obj.version || '1', 10);
    if (obj.expiresAt && obj.expiresAt >= nowIso() && tokenVersion === currentVersion) {
      CACHE.put('tok_' + t, JSON.stringify({ version: currentVersion }), 3600);
      return true;
    }
  } catch (_) {}

  return false;
}

function validateSenha(senha) {
  return verifyPassword_(senha, true);
}

function updatePassword_(currentPassword, newPassword) {
  const next = String(newPassword || '');
  if (!verifyPassword_(currentPassword, true)) return { error: 'Senha atual incorreta.' };
  if (next.length < 8) return { error: 'A nova senha deve ter pelo menos 8 caracteres.' };
  setPasswordHash_(next);
  revokeAllTokens_();
  updateConfigValues_({ senha: '' });
  return { updated: true, reauthRequired: true };
}

function definirSenhaInicial(senha) {
  if (SCRIPT_PROPS.getProperty(PASSWORD_HASH_KEY)) throw new Error('A senha inicial já foi definida.');
  setPasswordHash_(String(senha || ''));
  revokeAllTokens_();
  return 'Senha inicial definida com segurança.';
}

// ── Generic row helpers ───────────────────────────────────────
function insertRowsBatch_(sheetName, rowsToInsert) {
  if (!rowsToInsert || !rowsToInsert.length) return;
  const s = getSheet(sheetName);
  const start = s.getLastRow() + 1;
  s.getRange(start, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);
  invalidateSheetCache_(sheetName);
}

function upsertById_(sheetName, record) {
  return withDocumentLock_(() => upsertByIdUnlocked_(sheetName, record));
}

function upsertByIdUnlocked_(sheetName, record) {
  const s = getSheet(sheetName);
  const headers = SCHEMAS[sheetName];
  const id = record.id || uid(sheetName.slice(0, 3));
  // rowNumForId_ confere se o id realmente está naquela linha (protege contra planilha mexida à mão)
  const existingRow = record.id ? rowNumForId_(sheetName, id) : null;
  if (record.id && !existingRow) {
    return { error: 'O registro que você tentou editar não existe mais. Atualize a tela e tente novamente.' };
  }
  const timestamp = nowIso();

  // lê só a linha alvo, não a aba inteira
  const currentList = existingRow ? s.getRange(existingRow, 1, 1, headers.length).getValues()[0] : null;
  const deletedIndex = headers.indexOf('deletadoEm');
  if (currentList && deletedIndex >= 0 && currentList[deletedIndex]) {
    return { error: 'O registro que você tentou editar já foi excluído.' };
  }

  const rowObj = {};
  headers.forEach(h => rowObj[h] = '');

  headers.forEach(h => {
    if (Object.prototype.hasOwnProperty.call(record, h)) rowObj[h] = record[h];
  });

  rowObj.id = id;

  if (headers.indexOf('criadoEm') >= 0) {
    rowObj.criadoEm = existingRow && currentList
      ? currentList[headers.indexOf('criadoEm')]
      : (rowObj.criadoEm || timestamp);
  }
  if (headers.indexOf('atualizadoEm') >= 0) {
    rowObj.atualizadoEm = timestamp;
  }
  if (headers.indexOf('deletadoEm') >= 0 && !rowObj.deletadoEm) {
    rowObj.deletadoEm = existingRow && currentList
      ? currentList[headers.indexOf('deletadoEm')]
      : '';
  }

  const row = headers.map(h => rowObj[h]);

  if (existingRow) {
    s.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    s.getRange(s.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  }

  invalidateSheetCache_(sheetName);
  return { id: id, item: rowObj };
}

function softDeleteUnlocked_(sheetName, id) {
  const s = getSheet(sheetName);
  const rowNum = rowNumForId_(sheetName, id);
  if (!rowNum) return { error: 'Não encontrado' };

  const headers = SCHEMAS[sheetName];
  const delCol = headers.indexOf('deletadoEm');
  const updCol = headers.indexOf('atualizadoEm');

  if (delCol < 0) return { error: 'Aba sem suporte a soft delete' };

  const timestamp = nowIso();
  s.getRange(rowNum, delCol + 1).setValue(timestamp);
  if (updCol >= 0) s.getRange(rowNum, updCol + 1).setValue(timestamp);

  invalidateSheetCache_(sheetName);
  return { deleted: id };
}

function softDelete_(sheetName, id) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    return softDeleteUnlocked_(sheetName, id);
  } finally {
    lock.releaseLock();
  }
}

// ── Colaboradores ─────────────────────────────────────────────
function saveColaborador(d) {
  d = d || {};
  const nome = cleanText_(d && d.nome, 120);
  if (!nome) return { error: 'Nome da colaboradora é obrigatório.' };
  const start = d.horaInicio || '08:00';
  const end = d.horaFim || '18:00';
  if (!validTime_(start) || !validTime_(end)) return { error: 'Informe horários válidos para a colaboradora.' };
  if (start >= end) return { error: 'O horário final deve ser posterior ao inicial.' };
  return upsertById_('colaboradores', {
    id: d.id || '',
    nome: nome,
    cargo: cleanText_(d.cargo, 120),
    telefone: cleanText_(d.telefone, 30),
    horaInicio: start,
    horaFim: end,
    ativo: normalizeBoolStr(d.ativo, 'true')
  });
}

// ── Serviços ──────────────────────────────────────────────────
function saveServico(d) {
  d = d || {};
  const nome = cleanText_(d && d.nome, 120);
  const duration = parseInt(d && d.duracaoMin || 60, 10);
  if (!nome) return { error: 'Nome do serviço é obrigatório.' };
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return { error: 'Duração do serviço inválida.' };
  return upsertById_('servicos', {
    id: d.id || '',
    nome: nome,
    descricao: cleanText_(d.descricao, 300),
    duracaoMin: duration,
    ativo: normalizeBoolStr(d.ativo, 'true')
  });
}

// ── Produtos ──────────────────────────────────────────────────
function saveProduto(d) {
  d = d || {};
  const nome = cleanText_(d && d.nome, 120);
  const priceCents = paraCentavos_(d && d.preco || 0);
  if (!nome) return { error: 'Nome do produto é obrigatório.' };
  if (priceCents < 0) return { error: 'Preço do produto inválido.' };
  return upsertById_('produtos', {
    id: d.id || '',
    nome: nome,
    preco: deCentavos_(priceCents),
    descricao: cleanText_(d.descricao, 300),
    ativo: normalizeBoolStr(d.ativo, 'true')
  });
}

// ── Clientes ──────────────────────────────────────────────────
function getClientes(e) {
  const q = String(e.parameter.busca || '').toLowerCase().trim();
  let list = getCachedRows_('clientes', 120);
  if (q) {
    list = list.filter(c =>
      String(c.nome || '').toLowerCase().includes(q) ||
      String(c.telefone || '').includes(q)
    );
  }
  return list;
}

function saveCliente(d) {
  d = d || {};
  const nome = cleanText_(d && d.nome, 120);
  if (!nome) return { error: 'Nome da cliente é obrigatório.' };
  return upsertById_('clientes', {
    id: d.id || '',
    nome: nome,
    telefone: cleanText_(d.telefone, 30),
    email: cleanText_(d.email, 180),
    aniversario: cleanText_(d.aniversario, 10),
    observacoes: cleanText_(d.observacoes, 1000)
  });
}

// ── Caixa ─────────────────────────────────────────────────────
function caixaDiaList_(data) {
  const cacheKey = 'caixa_dia_' + data;
  const cached = CACHE.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const list = getCachedRows_('caixa').filter(r => normDate(r.data) === data);
  CACHE.put(cacheKey, JSON.stringify(list), 120);
  return list;
}

function invalidateCaixaCaches_(data) {
  invalidateSheetCache_('caixa');
  CACHE.remove('caixa_dia_' + data);
}

function getCaixa(e) {
  const data = toISO(e.parameter.data || today());
  return caixaDiaList_(data);
}

function getCaixaResumo(e) {
  const data = toISO(e.parameter.data || today());
  const list = caixaDiaList_(data);

  let entradas = 0;
  let saidas = 0;
  const pf = {};

  list.forEach(r => {
    const v = normalizeNumber(r.valor);
    if (r.tipo === 'entrada') {
      entradas += v;
      pf[r.formaPagamento] = (pf[r.formaPagamento] || 0) + v;
    } else {
      saidas += v;
    }
  });

  return {
    data: data,
    entradas: entradas,
    saidas: saidas,
    saldo: entradas - saidas,
    porForma: pf,
    total: list.length
  };
}

function saveLancamentoUnlocked_(d) {
  d = d || {};
  const dataLanc = toISO(d.data || today());
  let previousDate = '';
  if (d.id) {
    const previousRow = rowNumForId_('caixa', d.id);
    if (previousRow) {
      previousDate = normDate(getSheet('caixa').getRange(previousRow, SCHEMAS.caixa.indexOf('data') + 1).getValue());
    }
  }
  if (['entrada','saida'].indexOf(d.tipo) < 0) return { error: 'Tipo de lançamento inválido.' };
  const type = d.tipo;
  const valueCents = paraCentavos_(d.valor);
  if (valueCents <= 0) return { error: 'O valor do lançamento deve ser maior que zero.' };
  const allowedPayments = ['dinheiro','pix','debito','credito','fiado'];
  const payment = allowedPayments.indexOf(d.formaPagamento) >= 0 ? d.formaPagamento : 'dinheiro';
  const ret = upsertByIdUnlocked_('caixa', {
    id: d.id || '',
    data: dataLanc,
    tipo: type,
    categoria: cleanText_(d.categoria, 120),
    clienteId: d.clienteId || '',
    clienteNome: cleanText_(d.clienteNome, 120),
    itemId: d.itemId || '',
    itemNome: cleanText_(d.itemNome, 500),
    itemTipo: cleanText_(d.itemTipo, 40),
    valor: deCentavos_(valueCents),
    formaPagamento: payment,
    observacoes: cleanText_(d.observacoes, 2000),
    isRetirada: d.isRetirada ? 'true' : 'false'
  });

  invalidateCaixaCaches_(dataLanc);
  if (previousDate && previousDate !== dataLanc) invalidateCaixaCaches_(previousDate);
  return ret;
}

function saveLancamento(d) {
  return withDocumentLock_(() => saveLancamentoUnlocked_(d));
}

function deleteLancamento_(id) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const rowNum = rowNumForId_('caixa', id);
    if (!rowNum) return { error: 'Lançamento não encontrado.' };
    const data = normDate(getSheet('caixa').getRange(rowNum, SCHEMAS.caixa.indexOf('data') + 1).getValue());
    const deleted = softDeleteUnlocked_('caixa', id);
    if (!deleted.error && data) invalidateCaixaCaches_(data);
    return deleted;
  } finally {
    lock.releaseLock();
  }
}

function getHistoricoCliente(e) {
  const clienteId = String(e.parameter.clienteId || '');
  return getCachedRows_('caixa').filter(r =>
    String(r.clienteId) === clienteId &&
    r.tipo === 'entrada'
  );
}

// ── Extrato ───────────────────────────────────────────────────
function getExtrato(e) {
  let list = getCachedRows_('caixa');
  let label = '';
  if (!!e.parameter.dataInicio !== !!e.parameter.dataFim) throw new Error('Informe as duas datas do período.');

  if (e.parameter.dataInicio && e.parameter.dataFim) {
    const di = toISO(e.parameter.dataInicio);
    const df = toISO(e.parameter.dataFim);
    if (di > df) throw new Error('Período inválido: a data inicial deve vir antes da final.');
    list = list.filter(r => {
      const d = normDate(r.data);
      return d >= di && d <= df;
    });
    label = `${fmtBR(di)} a ${fmtBR(df)}`;
  } else {
    const mes = parseInt(e.parameter.mes || (new Date().getMonth() + 1), 10);
    const ano = parseInt(e.parameter.ano || new Date().getFullYear(), 10);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(ano) || ano < 1900 || ano > 2200) throw new Error('Mês ou ano inválido.');

    list = list.filter(r => {
      const d = normDate(r.data);
      if (!d) return false;
      const dt = new Date(d + 'T00:00:00');
      return dt.getMonth() + 1 === mes && dt.getFullYear() === ano;
    });

    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    label = MESES[mes - 1] + ' ' + ano;
  }

  let faturamento = 0;
  let saidasOp = 0;
  let retiradas = 0;

  const pf = {};
  const pc = {};
  const pd = {};

  list.forEach(r => {
    const v = normalizeNumber(r.valor);
    const dia = normDate(r.data);

    if (!pd[dia]) pd[dia] = { entradas: 0, saidas: 0, retiradas: 0, lancamentos: [] };
    pd[dia].lancamentos.push(r);

    if (r.tipo === 'entrada') {
      faturamento += v;
      pd[dia].entradas += v;
      pf[r.formaPagamento] = (pf[r.formaPagamento] || 0) + v;
    } else if (r.categoria === 'Retirada Pessoal' || r.isRetirada === 'true') {
      retiradas += v;
      pd[dia].retiradas += v;
      pd[dia].saidas += v;
    } else {
      saidasOp += v;
      pd[dia].saidas += v;
      pc[r.categoria || 'Outros'] = (pc[r.categoria || 'Outros'] || 0) + v;
    }
  });

  const totalSaidas = saidasOp + retiradas;
  const resultadoOp = faturamento - saidasOp;
  const resultadoFinal = faturamento - totalSaidas;

  return {
    label: label,
    faturamento: faturamento,
    saidasOp: saidasOp,
    retiradas: retiradas,
    totalSaidas: totalSaidas,
    resultadoOp: resultadoOp,
    resultadoFinal: resultadoFinal,
    porForma: pf,
    porCategoria: pc,
    dias: Object.keys(pd).sort().map(d => ({ data: d, ...pd[d] })),
    total: list.length
  };
}

// ── Crediário ─────────────────────────────────────────────────
function getCrediario(e) {
  let list = getCachedRows_('crediario');
  if (e.parameter.clienteId) {
    const clienteId = String(e.parameter.clienteId);
    list = list.filter(c => String(c.clienteId) === clienteId);
  }
  return list;
}

function getCrediarioMovs(e) {
  let list = getCachedRows_('crediario_mov');
  if (e.parameter.crediarioId) {
    const crediarioId = String(e.parameter.crediarioId);
    list = list.filter(m => String(m.crediarioId) === crediarioId);
  }
  return list;
}

function markRowDeletedUnlocked_(sheetName, id, timestamp) {
  const rowNum = rowNumForId_(sheetName, id);
  if (!rowNum) return;
  const headers = SCHEMAS[sheetName];
  const deletedCol = headers.indexOf('deletadoEm');
  const updatedCol = headers.indexOf('atualizadoEm');
  const s = getSheet(sheetName);
  if (deletedCol >= 0) s.getRange(rowNum, deletedCol + 1).setValue(timestamp || nowIso());
  if (updatedCol >= 0) s.getRange(rowNum, updatedCol + 1).setValue(timestamp || nowIso());
  invalidateSheetCache_(sheetName);
}

function findCashByItemId_(itemId) {
  const target = String(itemId || '');
  if (!target) return null;
  return getCachedRows_('caixa').find(function (row) {
    return String(row.itemId || '') === target;
  }) || null;
}

function saveLancamentoFiado(d) {
  d = d || {};
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const idempotencyKey = String(d.idempotencyKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    if (!idempotencyKey) return { error: 'Identificador da operação ausente. Reabra a tela e tente novamente.' };
    const credId = 'cred_' + idempotencyKey;
    const existing = rowNumForId_('crediario', credId);
    let reusableRow = null;
    if (existing) {
      const existingValues = getSheet('crediario').getRange(existing, 1, 1, SCHEMAS.crediario.length).getValues()[0];
      const deletedAt = existingValues[SCHEMAS.crediario.indexOf('deletadoEm')];
      if (!deletedAt) return { id: credId, duplicate: true };
      reusableRow = existing;
    }

    const entradaCentavos = paraCentavos_(d.valorEntrada || 0);
    const totalCentavos = paraCentavos_(d.valorTotal);
    const numParcelas = parseInt(d.numParcelas || 1, 10);
    if (totalCentavos <= 0) return { error: 'Informe um valor total maior que zero.' };
    if (entradaCentavos < 0 || entradaCentavos > totalCentavos) return { error: 'A entrada não pode ser maior que o valor total.' };
    if (!Number.isInteger(numParcelas) || numParcelas < 1 || numParcelas > 36) return { error: 'O número de parcelas deve estar entre 1 e 36.' };
    const clienteNome = cleanText_(d.clienteNome, 120);
    if (!clienteNome) return { error: 'Selecione a cliente do fiado.' };
    const saldoCentavos = totalCentavos - entradaCentavos;
    if (saldoCentavos > 0 && numParcelas > saldoCentavos) return { error: 'Reduza o número de parcelas: cada parcela precisa ter ao menos R$ 0,01.' };
    const parcelasCentavos = dividirCentavos_(saldoCentavos, numParcelas, 36);
    const entradaValor = deCentavos_(entradaCentavos);
    const valorTotal = deCentavos_(totalCentavos);
    const saldo = deCentavos_(saldoCentavos);
    const valorParcela = deCentavos_(parcelasCentavos[0]);
    const timestamp = nowIso();
    const dataLancamento = toISO(d.data || today());
    const vencimentos = d.vencimentos || [];
    if (vencimentos.length !== numParcelas) return { error: 'Informe a data de vencimento de todas as parcelas.' };
    const normalizedVencimentos = vencimentos.map(function (v) { return toISO(v); });

    const credRow = [[
      credId,
      d.clienteId || '',
      clienteNome,
      'parcelado',
      valorTotal,
      entradaValor,
      saldo,
      numParcelas,
      valorParcela,
      saldo <= 0 ? 'quitado' : 'aberto',
      cleanText_(d.observacoes, 1000),
      timestamp,
      '',
      ''
    ]];
    const movRows = [];
    const movIds = [];
    for (let i = 0; i < numParcelas && saldoCentavos > 0; i++) {
      const movId = uid('mov');
      movIds.push(movId);
      movRows.push([
        movId,
        credId,
        d.clienteId || '',
        clienteNome,
        'parcela',
        deCentavos_(parcelasCentavos[i]),
        i + 1,
        normalizedVencimentos[i],
        'aberto',
        '',
        timestamp,
        '',
        ''
      ]);
    }
    let cashId = '';
    try {
      if (reusableRow) {
        getSheet('crediario').getRange(reusableRow, 1, 1, credRow[0].length).setValues(credRow);
        invalidateSheetCache_('crediario');
      } else {
        insertRowsBatch_('crediario', credRow);
      }
      insertRowsBatch_('crediario_mov', movRows);

      if (entradaValor > 0) {
        const cashResult = saveLancamentoUnlocked_({
          tipo: 'entrada',
          clienteId: d.clienteId,
          clienteNome: clienteNome,
          itemId: 'fiadoentrada:' + idempotencyKey,
          itemNome: cleanText_(d.itemNome, 300) || 'Entrada de fiado',
          itemTipo: cleanText_(d.itemTipo, 40) || 'crediario',
          valor: entradaValor,
          formaPagamento: d.formaEntrada || 'dinheiro',
          observacoes: 'Entrada fiado' + (d.observacoes ? ' · ' + cleanText_(d.observacoes, 1000) : ''),
          data: dataLancamento
        });
        if (cashResult.error) throw new Error(cashResult.error);
        cashId = cashResult.id;
      }
    } catch (writeError) {
      markRowDeletedUnlocked_('crediario', credId, timestamp);
      movIds.forEach(function (id) { markRowDeletedUnlocked_('crediario_mov', id, timestamp); });
      if (cashId) markRowDeletedUnlocked_('caixa', cashId, timestamp);
      throw writeError;
    }

    return { id: credId, saldo: saldo };
  } finally {
    lock.releaseLock();
  }
}

function pagarCrediario(b) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const crediarioId = String(b.crediarioId || '');
    const idempotencyKey = String(b.idempotencyKey || '').trim();
    if (!idempotencyKey) return { error: 'Identificador do pagamento ausente. Reabra a tela e tente novamente.' };
    const cashItemId = 'credpg:' + idempotencyKey;
    const existingCash = findCashByItemId_(cashItemId);
    if (existingCash) return { duplicate: true, cashId: existingCash.id };

    const valorCentavos = paraCentavos_(b.valor);
    const valor = deCentavos_(valorCentavos);
    const parcela = String(b.parcela || '');
    const observacoes = b.observacoes || '';

    const rowNum = rowNumForId_('crediario', crediarioId);
    if (!rowNum) return { error: 'Crediário não encontrado' };

    const s = getSheet('crediario');
    const row = s.getRange(rowNum, 1, 1, SCHEMAS.crediario.length).getValues()[0];
    const saldoAtualCentavos = paraCentavos_(row[6]);
    const movData = sheetData_('crediario_mov');
    const colCred = movData.headers.indexOf('crediarioId');
    const colParc = movData.headers.indexOf('numParcela');
    const colStatus = movData.headers.indexOf('status');
    const colValor = movData.headers.indexOf('valor');
    const colVencimento = movData.headers.indexOf('vencimento');
    const colDeleted = movData.headers.indexOf('deletadoEm');
    const openMovements = [];
    for (let i = 0; i < movData.rows.length; i++) {
      const candidate = movData.rows[i];
      if (String(candidate[colCred]) === crediarioId && String(candidate[colStatus]) === 'aberto' && !candidate[colDeleted]) {
        openMovements.push({ rowNum: i + 2, row: candidate.slice() });
      }
    }
    openMovements.sort(function (left, right) {
      return String(left.row[colVencimento] || '').localeCompare(String(right.row[colVencimento] || '')) ||
        Number(left.row[colParc] || 0) - Number(right.row[colParc] || 0);
    });
    let openMovementCents = openMovements.reduce(function (sum, item) { return sum + paraCentavos_(item.row[colValor]); }, 0);
    if (openMovementCents !== saldoAtualCentavos) {
      const difference = saldoAtualCentavos - openMovementCents;
      const lastMovement = openMovements[openMovements.length - 1];
      const lastCents = lastMovement ? paraCentavos_(lastMovement.row[colValor]) : 0;
      const repairedCents = lastCents + difference;
      if (!lastMovement || Math.abs(difference) > openMovements.length || repairedCents <= 0) {
        return { error: 'As parcelas abertas não correspondem ao saldo. Atualize os dados antes de receber.' };
      }
      getSheet('crediario_mov').getRange(lastMovement.rowNum, colValor + 1).setValue(deCentavos_(repairedCents));
      lastMovement.row[colValor] = deCentavos_(repairedCents);
      openMovementCents = saldoAtualCentavos;
      invalidateSheetCache_('crediario_mov');
    }

    let movRowNum = null;
    let parcelaCentavos = null;

    if (parcela) {
      const selectedMovement = openMovements.find(function (item) { return String(item.row[colParc]) === parcela; });
      if (selectedMovement) {
        movRowNum = selectedMovement.rowNum;
        parcelaCentavos = paraCentavos_(selectedMovement.row[colValor]);
      }
      if (!movRowNum) return { error: 'Parcela aberta não encontrada.' };
    }

    const validation = validarPagamento_(valorCentavos, saldoAtualCentavos, parcelaCentavos);
    if (!validation.ok) return { error: validation.message };

    const novoSaldoCentavos = saldoAtualCentavos - valorCentavos;
    const novoSaldo = deCentavos_(novoSaldoCentavos);
    const status = novoSaldo <= 0 ? 'quitado' : 'aberto';

    const rowSnapshot = row.slice();
    const movementSnapshots = [];
    try {
      s.getRange(rowNum, 7).setValue(novoSaldo);
      s.getRange(rowNum, 10).setValue(status);
      s.getRange(rowNum, 13).setValue(nowIso());

      if (parcela) {
        const movSheet = getSheet('crediario_mov');
        const headers = SCHEMAS.crediario_mov;
        const selectedSnapshot = openMovements.find(function (item) { return item.rowNum === movRowNum; });
        movementSnapshots.push(selectedSnapshot);
        movSheet.getRange(movRowNum, headers.indexOf('status') + 1).setValue('pago');
        movSheet.getRange(movRowNum, headers.indexOf('observacoes') + 1).setValue(cleanText_(observacoes, 1000));
        movSheet.getRange(movRowNum, headers.indexOf('atualizadoEm') + 1).setValue(nowIso());
        invalidateSheetCache_('crediario_mov');
      } else {
        const movSheet = getSheet('crediario_mov');
        const headers = SCHEMAS.crediario_mov;
        const allocation = alocarPagamento_(openMovements.map(function (item) {
          return paraCentavos_(item.row[colValor]);
        }), valorCentavos);
        for (let i = 0; i < openMovements.length && allocation[i].aplicadoCentavos > 0; i++) {
          const movement = openMovements[i];
          const applied = allocation[i];
          movementSnapshots.push(movement);
          if (applied.pago) {
            movSheet.getRange(movement.rowNum, headers.indexOf('status') + 1).setValue('pago');
            movSheet.getRange(movement.rowNum, headers.indexOf('observacoes') + 1).setValue(cleanText_('Baixa automática por pagamento sem parcela. ' + observacoes, 1000));
          } else {
            movSheet.getRange(movement.rowNum, headers.indexOf('valor') + 1).setValue(deCentavos_(applied.restanteCentavos));
            movSheet.getRange(movement.rowNum, headers.indexOf('observacoes') + 1).setValue(cleanText_('Pagamento parcial aplicado. ' + observacoes, 1000));
          }
          movSheet.getRange(movement.rowNum, headers.indexOf('atualizadoEm') + 1).setValue(nowIso());
        }
        invalidateSheetCache_('crediario_mov');
      }

      const savedCash = saveLancamentoUnlocked_({
        tipo: 'entrada',
        clienteId: row[1],
        clienteNome: row[2],
        itemId: cashItemId,
        itemNome: 'Recebimento de fiado',
        itemTipo: 'crediario',
        valor: valor,
        formaPagamento: b.formaPagamento || 'dinheiro',
        observacoes: `Receb. fiado${parcela ? ' parc.' + parcela : ' parcial'}${observacoes ? ' · ' + cleanText_(observacoes, 1000) : ''}`,
        data: toISO(b.data || today())
      });
      if (savedCash.error) throw new Error(savedCash.error);
    } catch (writeError) {
      s.getRange(rowNum, 1, 1, rowSnapshot.length).setValues([rowSnapshot]);
      movementSnapshots.filter(Boolean).forEach(function (snapshot) {
        getSheet('crediario_mov').getRange(snapshot.rowNum, 1, 1, snapshot.row.length).setValues([snapshot.row]);
      });
      invalidateSheetCache_('crediario_mov');
      invalidateSheetCache_('crediario');
      throw writeError;
    }

    invalidateSheetCache_('crediario');
    return { saldo: novoSaldo, status: status, idempotencyKey: idempotencyKey };
  } finally {
    lock.releaseLock();
  }
}

function deleteCrediario(id) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const rowNum = rowNumForId_('crediario', id);
    if (!rowNum) return { error: 'Fiado não encontrado' };

    const ts = nowIso();
    const s = getSheet('crediario');
    const headers = SCHEMAS.crediario;
    const parentSnapshot = s.getRange(rowNum, 1, 1, headers.length).getValues()[0];

    // cascata: marca as parcelas (crediario_mov) deste fiado como excluídas
    const movSheet = getSheet('crediario_mov');
    const d = sheetData_('crediario_mov');
    const colCred = d.headers.indexOf('crediarioId');
    const colDel = d.headers.indexOf('deletadoEm');
    const relatedSnapshots = [];
    for (let i = 0; i < d.rows.length; i++) {
      if (String(d.rows[i][colCred]) === String(id) && !d.rows[i][colDel]) {
        relatedSnapshots.push({ rowNum: i + 2, row: d.rows[i].slice() });
      }
    }

    try {
      s.getRange(rowNum, headers.indexOf('deletadoEm') + 1).setValue(ts);
      s.getRange(rowNum, headers.indexOf('atualizadoEm') + 1).setValue(ts);
      relatedSnapshots.forEach(function (snapshot) {
        movSheet.getRange(snapshot.rowNum, colDel + 1).setValue(ts);
        movSheet.getRange(snapshot.rowNum, d.headers.indexOf('atualizadoEm') + 1).setValue(ts);
      });
    } catch (writeError) {
      s.getRange(rowNum, 1, 1, parentSnapshot.length).setValues([parentSnapshot]);
      relatedSnapshots.forEach(function (snapshot) {
        movSheet.getRange(snapshot.rowNum, 1, 1, snapshot.row.length).setValues([snapshot.row]);
      });
      invalidateSheetCache_('crediario');
      invalidateSheetCache_('crediario_mov');
      throw writeError;
    }

    invalidateSheetCache_('crediario');
    invalidateSheetCache_('crediario_mov');
    return { deleted: id };
  } finally {
    lock.releaseLock();
  }
}

// ── Agendamentos ──────────────────────────────────────────────
function getAgendamentos(e) {
  let list = getCachedRows_('agendamentos');
  if (!!e.parameter.dataInicio !== !!e.parameter.dataFim) throw new Error('Informe as duas datas do período.');

  if (e.parameter.data) {
    const data = toISO(e.parameter.data);
    list = list.filter(a => normDate(a.data) === data);
  }
  if (e.parameter.dataInicio && e.parameter.dataFim) {
    const di = toISO(e.parameter.dataInicio);
    const df = toISO(e.parameter.dataFim);
    if (di > df) throw new Error('Período inválido: a data inicial deve vir antes da final.');
    list = list.filter(a => {
      const d = normDate(a.data);
      return d >= di && d <= df;
    });
  }
  if (e.parameter.clienteId) {
    const clienteId = String(e.parameter.clienteId);
    list = list.filter(a => String(a.clienteId) === clienteId);
  }

  return list.sort((a, b) =>
    String(normDate(a.data) || '').localeCompare(String(normDate(b.data) || '')) ||
    String(a.hora || '').localeCompare(String(b.hora || ''))
  );
}

function saveAgendamentoUnlocked_(d) {
  d = d || {};
  const clienteNome = cleanText_(d.clienteNome, 120);
  const duration = parseInt(d.duracaoMin || 60, 10);
  const status = ['agendado','concluido','cancelado'].indexOf(d.status) >= 0 ? d.status : 'agendado';
  const valueCents = paraCentavos_(d.valor || 0);
  if (!clienteNome) return { error: 'Selecione a cliente do agendamento.' };
  if (!validTime_(d.hora || '09:00')) return { error: 'Horário do agendamento inválido.' };
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return { error: 'Duração do agendamento inválida.' };
  if (valueCents < 0) return { error: 'Valor do agendamento inválido.' };
  return upsertByIdUnlocked_('agendamentos', {
    id: d.id || '',
    data: toISO(d.data || today()),
    hora: d.hora || '09:00',
    duracaoMin: parseInt(d.duracaoMin || 60, 10),
    clienteId: d.clienteId || '',
    clienteNome: clienteNome,
    colaboradorId: d.colaboradorId || '',
    colaboradorNome: cleanText_(d.colaboradorNome, 120),
    servicos: cleanText_(d.servicos, 1000),
    valor: deCentavos_(valueCents),
    status: status,
    observacoes: cleanText_(d.observacoes, 1000)
  });
}

function saveAgendamento(d) {
  return withDocumentLock_(function () { return saveAgendamentoUnlocked_(d); });
}

function concluirAgendamentoComCaixa_(b) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const appointment = b.appointment || {};
    const cash = b.cash || {};
    const appointmentId = String(appointment.id || '');
    if (!appointmentId) return { error: 'Agendamento inválido.' };
    const cashItemId = 'agcash:' + appointmentId;
    const existingCash = findCashByItemId_(cashItemId);
    if (existingCash) return { completed: true, duplicate: true, cashId: existingCash.id };

    const rowNum = rowNumForId_('agendamentos', appointmentId);
    if (!rowNum) return { error: 'Agendamento não encontrado.' };
    const sheet = getSheet('agendamentos');
    const snapshot = sheet.getRange(rowNum, 1, 1, SCHEMAS.agendamentos.length).getValues()[0];

    try {
      const savedAppointment = saveAgendamentoUnlocked_({ ...appointment, status: 'concluido' });
      if (savedAppointment.error) return savedAppointment;
      const savedCash = saveLancamentoUnlocked_({
        ...cash,
        id: '',
        tipo: 'entrada',
        itemId: cashItemId,
        itemTipo: 'agendamento',
        data: toISO(cash.data || today())
      });
      if (savedCash.error) throw new Error(savedCash.error);
      return { completed: true, cashId: savedCash.id };
    } catch (writeError) {
      sheet.getRange(rowNum, 1, 1, snapshot.length).setValues([snapshot]);
      invalidateSheetCache_('agendamentos');
      throw writeError;
    }
  } finally {
    lock.releaseLock();
  }
}

// ── Planejamento ──────────────────────────────────────────────
function getPlanejamento(e) {
  let list = getCachedRows_('planejamento');
  if (e.parameter.tipo) {
    list = list.filter(p => p.tipo === e.parameter.tipo);
  }
  return list;
}

function savePlanejamento(d) {
  d = d || {};
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const id = d.id || uid('plan');
    const numParcelas = parseInt(d.numParcelas || 1, 10);
    const totalCentavos = paraCentavos_(d.valorTotal);
    if (totalCentavos <= 0) return { error: 'Informe um valor total maior que zero.' };
    if (!Number.isInteger(numParcelas) || numParcelas < 1 || numParcelas > 120) return { error: 'O número de parcelas deve estar entre 1 e 120.' };
    if (numParcelas > totalCentavos) return { error: 'Reduza o número de parcelas: cada parcela precisa ter ao menos R$ 0,01.' };
    const parcelasCentavos = dividirCentavos_(totalCentavos, numParcelas, 120);
    const valorTotal = deCentavos_(totalCentavos);
    const valorParcela = deCentavos_(parcelasCentavos[0]);
    const diaVencimento = parseInt(d.diaVencimento || 1, 10);
    if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) return { error: 'O dia de vencimento deve estar entre 1 e 31.' };
    const dataInicio = toISO(d.dataInicio || today());
    const descricao = cleanText_(d.descricao, 300);
    const planType = d.tipo === 'receita' ? 'receita' : 'despesa';
    if (!descricao) return { error: 'Descrição do planejamento é obrigatória.' };
    const timestamp = nowIso();

    const existing = d.id ? rowNumForId_('planejamento', d.id) : null;
    if (d.id && !existing) return { error: 'Planejamento não encontrado. Atualize a tela e tente novamente.' };

    const parcelData = sheetData_('plan_parcelas');
    const planCol = parcelData.headers.indexOf('planejamentoId');
    const paidCol = parcelData.headers.indexOf('pago');
    const deletedCol = parcelData.headers.indexOf('deletadoEm');
    const relatedRows = [];
    for (let i = 0; i < parcelData.rows.length; i++) {
      const candidate = parcelData.rows[i];
      if (String(candidate[planCol]) === String(id) && !candidate[deletedCol]) {
        if (isPaid_(candidate[paidCol])) {
          return { error: 'Este planejamento já possui parcela paga e não pode ser alterado.' };
        }
        relatedRows.push(i + 2);
      }
    }

    const rowsToInsert = [];
    const newParcelIds = [];
    for (let i = 0; i < numParcelas; i++) {
      const parcelId = uid('pp') + '-' + (i + 1);
      newParcelIds.push(parcelId);
      rowsToInsert.push([
        parcelId,
        id,
        descricao,
        planType,
        deCentavos_(parcelasCentavos[i]),
        dataMensalLimitada_(dataInicio, i, diaVencimento),
        'aberto',
        'false',
        '',
        '',
        timestamp,
        '',
        ''
      ]);
    }

    const planSheet = getSheet('planejamento');
    const planSnapshot = existing
      ? planSheet.getRange(existing, 1, 1, SCHEMAS.planejamento.length).getValues()[0]
      : null;
    const parcelSheet = getSheet('plan_parcelas');
    const relatedSnapshots = relatedRows.map(function (rowNum) {
      return { rowNum: rowNum, row: parcelSheet.getRange(rowNum, 1, 1, SCHEMAS.plan_parcelas.length).getValues()[0] };
    });

    try {

    if (existing) {
      const saved = upsertByIdUnlocked_('planejamento', {
        id: id,
        tipo: planType,
        descricao: descricao,
        valorTotal: valorTotal,
        numParcelas: numParcelas,
        valorParcela: valorParcela,
        diaVencimento: diaVencimento,
        dataInicio: dataInicio,
        status: 'ativo',
        observacoes: cleanText_(d.observacoes, 1000)
      });
      if (saved.error) return saved;
    } else {
      insertRowsBatch_('planejamento', [[
        id, planType, descricao, valorTotal, numParcelas,
        valorParcela, diaVencimento, dataInicio, 'ativo', cleanText_(d.observacoes, 1000),
        timestamp, '', ''
      ]]);
    }

    if (relatedRows.length) {
      const planParcelSheet = getSheet('plan_parcelas');
      relatedRows.forEach(function (rowNum) {
        planParcelSheet.getRange(rowNum, deletedCol + 1).setValue(timestamp);
        planParcelSheet.getRange(rowNum, parcelData.headers.indexOf('atualizadoEm') + 1).setValue(timestamp);
      });
      invalidateSheetCache_('plan_parcelas');
    }

    insertRowsBatch_('plan_parcelas', rowsToInsert);
    } catch (writeError) {
      if (planSnapshot) {
        planSheet.getRange(existing, 1, 1, planSnapshot.length).setValues([planSnapshot]);
      } else {
        markRowDeletedUnlocked_('planejamento', id, timestamp);
      }
      relatedSnapshots.forEach(function (snapshot) {
        parcelSheet.getRange(snapshot.rowNum, 1, 1, snapshot.row.length).setValues([snapshot.row]);
      });
      newParcelIds.forEach(function (parcelId) { markRowDeletedUnlocked_('plan_parcelas', parcelId, timestamp); });
      invalidateSheetCache_('planejamento');
      invalidateSheetCache_('plan_parcelas');
      throw writeError;
    }
    return { id: id, updated: !!existing };
  } finally {
    lock.releaseLock();
  }
}

function deletePlanejamento_(id) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const rowNum = rowNumForId_('planejamento', id);
    if (!rowNum) return { error: 'Planejamento não encontrado.' };

    const parcelData = sheetData_('plan_parcelas');
    const planCol = parcelData.headers.indexOf('planejamentoId');
    const paidCol = parcelData.headers.indexOf('pago');
    const deletedCol = parcelData.headers.indexOf('deletadoEm');
    const relatedRows = [];
    for (let i = 0; i < parcelData.rows.length; i++) {
      const candidate = parcelData.rows[i];
      if (String(candidate[planCol]) === String(id) && !candidate[deletedCol]) {
        if (isPaid_(candidate[paidCol])) {
          return { error: 'Este planejamento possui parcela paga e não pode ser excluído.' };
        }
        relatedRows.push(i + 2);
      }
    }

    const timestamp = nowIso();
    const planSheet = getSheet('planejamento');
    const parcelSheet = getSheet('plan_parcelas');
    const parentSnapshot = planSheet.getRange(rowNum, 1, 1, SCHEMAS.planejamento.length).getValues()[0];
    const relatedSnapshots = relatedRows.map(function (parcelRowNum) {
      return { rowNum: parcelRowNum, row: parcelData.rows[parcelRowNum - 2].slice() };
    });
    try {
      planSheet.getRange(rowNum, SCHEMAS.planejamento.indexOf('deletadoEm') + 1).setValue(timestamp);
      planSheet.getRange(rowNum, SCHEMAS.planejamento.indexOf('atualizadoEm') + 1).setValue(timestamp);
      relatedRows.forEach(function (parcelRowNum) {
        parcelSheet.getRange(parcelRowNum, deletedCol + 1).setValue(timestamp);
        parcelSheet.getRange(parcelRowNum, parcelData.headers.indexOf('atualizadoEm') + 1).setValue(timestamp);
      });
    } catch (writeError) {
      planSheet.getRange(rowNum, 1, 1, parentSnapshot.length).setValues([parentSnapshot]);
      relatedSnapshots.forEach(function (snapshot) {
        parcelSheet.getRange(snapshot.rowNum, 1, 1, snapshot.row.length).setValues([snapshot.row]);
      });
      invalidateSheetCache_('planejamento');
      invalidateSheetCache_('plan_parcelas');
      throw writeError;
    }

    invalidateSheetCache_('planejamento');
    invalidateSheetCache_('plan_parcelas');
    return { deleted: id };
  } finally {
    lock.releaseLock();
  }
}

function pagarParcela(b) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const parcelaId = String(b.parcelaId || '');
    const rowNum = rowNumForId_('plan_parcelas', parcelaId);
    if (!rowNum) return { error: 'Parcela não encontrada' };

    const s = getSheet('plan_parcelas');
    const row = s.getRange(rowNum, 1, 1, SCHEMAS.plan_parcelas.length).getValues()[0];
    const existingCash = findCashByItemId_(parcelaId);
    if (existingCash) return { ok: true, duplicate: true, cashId: existingCash.id };
    if (isPaid_(row[7])) {
      return { error: 'Esta parcela já está paga.' };
    }
    const paymentDate = toISO(b.dataPagamento || today());
    try {
      s.getRange(rowNum, 8).setValue('true');     // pago
      s.getRange(rowNum, 7).setValue('pago');     // status
      s.getRange(rowNum, 9).setValue(paymentDate); // dataPagamento
      s.getRange(rowNum, 10).setValue(b.observacoes || '');
      s.getRange(rowNum, 12).setValue(nowIso());  // atualizadoEm

      invalidateSheetCache_('plan_parcelas');

      if (String(row[3]) === 'despesa' && b.registrarCaixa !== false) {
        const cashResult = saveLancamentoUnlocked_({
          tipo: 'saida',
          categoria: b.categoria || 'Obrigação programada',
          itemId: parcelaId,
          itemNome: row[2] || 'Obrigação',
          itemTipo: 'planejamento',
          valor: deCentavos_(paraCentavos_(row[4])),
          formaPagamento: b.formaPagamento || 'dinheiro',
          observacoes: b.observacoes || 'Baixa de obrigação programada',
          data: paymentDate
        });
        if (cashResult.error) throw new Error(cashResult.error);
      }
    } catch (writeError) {
      s.getRange(rowNum, 1, 1, row.length).setValues([row]);
      invalidateSheetCache_('plan_parcelas');
      throw writeError;
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getPlanejamentoParcelas(e) {
  let list = getCachedRows_('plan_parcelas');
  if (e.parameter.planejamentoId) {
    const planejamentoId = String(e.parameter.planejamentoId);
    list = list.filter(p => String(p.planejamentoId) === planejamentoId);
  }
  return list.sort((a, b) =>
    String(a.vencimento || '').localeCompare(String(b.vencimento || ''))
  );
}

function getVencimentos(e) {
  const di = toISO(e.parameter.dataInicio || today());
  const df = toISO(e.parameter.dataFim || (function () {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
  })());
  if (di > df) throw new Error('Período inválido: a data inicial deve vir antes da final.');

  const parcelas = getCachedRows_('plan_parcelas')
    .filter(p => !isPaid_(p.pago) && p.vencimento >= di && p.vencimento <= df)
    .map(p => ({ ...p, _tipo: 'despesa' }));

  const fiado = getCachedRows_('crediario_mov')
    .filter(m => m.status === 'aberto' && m.vencimento >= di && m.vencimento <= df)
    .map(m => ({ ...m, _tipo: 'recebimento' }));

  return parcelas.concat(fiado).sort((a, b) =>
    String(a.vencimento || '').localeCompare(String(b.vencimento || ''))
  );
}

function getAtrasados() {
  const td = today();

  const parcAtrasadas = getCachedRows_('plan_parcelas')
    .filter(p => !isPaid_(p.pago) && p.vencimento && p.vencimento < td)
    .map(p => ({ ...p, _tipo: 'despesa' }));

  const fiadoAtrasado = getCachedRows_('crediario_mov')
    .filter(m => m.status === 'aberto' && m.vencimento && m.vencimento < td)
    .map(m => ({ ...m, _tipo: 'recebimento' }));

  return parcAtrasadas.concat(fiadoAtrasado).sort((a, b) =>
    String(a.vencimento || '').localeCompare(String(b.vencimento || ''))
  );
}

function getHomeResumo(e) {
  const mes = String(e.parameter.mes || today().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(mes) || !validarDataISO_(mes + '-01')) throw new Error('Mês inválido.');
  const [ano, mm] = mes.split('-').map(Number);
  const dataInicio = `${ano}-${String(mm).padStart(2, '0')}-01`;
  const lastDay = new Date(ano, mm, 0).getDate();
  const dataFim = `${ano}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const extrato = getExtrato({ parameter: { dataInicio: dataInicio, dataFim: dataFim } });
  const fiadosAbertos = getCachedRows_('crediario')
    .filter(c => c.status === 'aberto')
    .reduce((s, c) => s + normalizeNumber(c.saldoDevedor), 0);

  const obrigacoesAbertas = getCachedRows_('plan_parcelas')
    .filter(p =>
      p.tipo === 'despesa' &&
      !isPaid_(p.pago) &&
      !isPaid_(p.status) &&
      p.vencimento &&
      p.vencimento <= dataFim
    )
    .reduce((s, p) => s + normalizeNumber(p.valor), 0);

  const metaNegocio = normalizeNumber(extrato.saidasOp) + obrigacoesAbertas;
  const resultadoOperacionalProjetado = normalizeNumber(extrato.faturamento) - metaNegocio;

  return {
    mes: mes,
    clientes: getCachedRows_('clientes').length,
    servicos: getCachedRows_('servicos').length,
    fiadosAbertos: fiadosAbertos,
    obrigacoesAbertas: obrigacoesAbertas,
    metaNegocio: metaNegocio,
    resultadoOperacionalProjetado: resultadoOperacionalProjetado,
    extrato: extrato
  };
}

// ── Delete genérico (soft delete) ─────────────────────────────
function deleteRow(sheetName, id) {
  const allowed = ['colaboradores','servicos','produtos','clientes'];
  if (allowed.indexOf(String(sheetName || '')) < 0) return { error: 'Exclusão não permitida para esta área.' };
  return softDelete_(sheetName, id);
}

// ── Routers ───────────────────────────────────────────────────
function readAction_(a, e) {
  switch (a) {
    case 'getConfig':           return ok(getPublicConfig_());
    case 'getColaboradores':    return ok(getCachedRows_('colaboradores'));
    case 'getServicos':         return ok(getCachedRows_('servicos'));
    case 'getProdutos':         return ok(getCachedRows_('produtos'));
    case 'getClientes':         return ok(getClientes(e));
    case 'getCaixa':            return ok(getCaixa(e));
    case 'getCaixaResumo':      return ok(getCaixaResumo(e));
    case 'getExtrato':          return ok(getExtrato(e));
    case 'getHistoricoCliente': return ok(getHistoricoCliente(e));
    case 'getCrediario':        return ok(getCrediario(e));
    case 'getCrediarioMovs':    return ok(getCrediarioMovs(e));
    case 'getAgendamentos':     return ok(getAgendamentos(e));
    case 'getPlanejamento':     return ok(getPlanejamento(e));
    case 'getPlanejamentoParcelas': return ok(getPlanejamentoParcelas(e));
    case 'getVencimentos':      return ok(getVencimentos(e));
    case 'getAtrasados':        return ok(getAtrasados());
    case 'getHomeResumo':       return ok(getHomeResumo(e));
    default: return err('Ação desconhecida: ' + a);
  }
}

function doGet(e) {
  try {
    ensureSheetsOnce_();

    const a =e.parameter.action;
    const t = e.parameter.token;

    if (a === 'login') return err('O login deve ser enviado por POST.');
    if (!validateToken(t)) return err('Sessão expirada.');

    return readAction_(a, e);
  } catch (e2) {
    return err('Erro interno: ' + e2.message);
  }
}

function doPost(e) {
  try {
    ensureSheetsOnce_();

    let b = {};
    try { b = JSON.parse(e.postData.contents || '{}'); } catch (_) {}

    const a = b.action;
    const t = b.token;

    if (a === 'login') return authLogic(b.senha, b.lembrar);
    if (!validateToken(t)) return err('Sessão expirada.');
    if (b.readOnly === true) return readAction_(a, { parameter: b });

    switch (a) {
      case 'saveColaborador':    return result(saveColaborador(b.data));
      case 'saveServico':        return result(saveServico(b.data));
      case 'saveProduto':        return result(saveProduto(b.data));
      case 'saveCliente':        return result(saveCliente(b.data));
      case 'saveLancamento':     return result(saveLancamento(b.data));
      case 'saveAgendamento':    return result(saveAgendamento(b.data));
      case 'completeAppointment': return result(concluirAgendamentoComCaixa_(b));
      case 'savePlanejamento':   return result(savePlanejamento(b.data));
      case 'deletePlanejamento': return result(deletePlanejamento_(b.id));
      case 'pagarParcela':       return result(pagarParcela(b));
      case 'saveFiado':          return result(saveLancamentoFiado(b.data));
      case 'pagarCrediario':     return result(pagarCrediario(b));
      case 'updateConfig':       return result(updateConfig(b.config));
      case 'updatePassword':     return result(updatePassword_(b.currentPassword, b.newPassword));
      case 'logout':             return result(logoutToken_(t));
      case 'verificarSenha':     return ok({ valido: validateSenha(b.senha) });
      case 'deleteRow':          return result(deleteRow(b.sheet, b.id));
      case 'deleteAgendamento':  return result(softDelete_('agendamentos', b.id));
      case 'deleteLancamento':   return result(deleteLancamento_(b.id));
      case 'deleteCrediario':    return result(deleteCrediario(b.id));
      default: return err('Ação desconhecida: ' + a);
    }
  } catch (e2) {
    return err('Erro interno: ' + e2.message);
  }
}
