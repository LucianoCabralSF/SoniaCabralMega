// ============================================================
// SONIA CABRAL — Google Apps Script OTIMIZADO (v2)
// Substitui o backend anterior após a migração da planilha
// ============================================================

// ── Constantes ────────────────────────────────────────────────
const CACHE = CacheService.getScriptCache();
const SCRIPT_PROPS = PropertiesService.getScriptProperties();

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
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, a] = s.split('/');
    return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return normDate(s);
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
    senha: '1234',
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
    ids.forEach((id, i) => {
      if (id) idx[String(id)] = i + 2;
    });
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

function updateConfig(cfg) {
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

function authLogic(senha) {
  const cfg = getConfigObj();
  if (String(cfg.senha || '') !== String(senha || '')) return err('Senha incorreta.');

  limparTokensExpirados_();

  const token = Utilities.getUuid();
  CACHE.put('tok_' + token, '1', 3600);

  const longToken = Utilities.getUuid();
  const ttl = parseInt(cfg.tokenTTL || '2592000', 10);
  SCRIPT_PROPS.setProperty('ltok_' + longToken, JSON.stringify({
    createdAt: nowIso(),
    expiresAt: Utilities.formatDate(new Date(Date.now() + ttl * 1000), tz(), "yyyy-MM-dd'T'HH:mm:ss")
  }));

  return ok({
    token: token,
    longToken: longToken,
    salonName: cfg.salonName || 'Sonia Cabral'
  });
}

function validateToken(t) {
  if (!t) return false;
  if (CACHE.get('tok_' + t) === '1') return true;

  const raw = SCRIPT_PROPS.getProperty('ltok_' + t);
  if (!raw) return false;

  try {
    const obj = JSON.parse(raw);
    if (obj.expiresAt && obj.expiresAt >= nowIso()) {
      CACHE.put('tok_' + t, '1', 3600);
      return true;
    }
  } catch (_) {}

  return false;
}

function validateSenha(senha) {
  const cfg = getConfigObj();
  return String(cfg.senha || '') === String(senha || '');
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
  const timestamp = nowIso();

  // lê só a linha alvo, não a aba inteira
  const currentList = existingRow ? s.getRange(existingRow, 1, 1, headers.length).getValues()[0] : null;

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

function softDelete_(sheetName, id) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const s = getSheet(sheetName);
    const rowNum = rowNumForId_(sheetName, id);
    if (!rowNum) return { error: 'Não encontrado' };

    const headers = SCHEMAS[sheetName];
    const delCol = headers.indexOf('deletadoEm');
    const updCol = headers.indexOf('atualizadoEm');

    if (delCol < 0) return { error: 'Aba sem suporte a soft delete' };

    s.getRange(rowNum, delCol + 1).setValue(nowIso());
    if (updCol >= 0) s.getRange(rowNum, updCol + 1).setValue(nowIso());

    invalidateSheetCache_(sheetName);
    return { deleted: id };
  } finally {
    lock.releaseLock();
  }
}

// ── Colaboradores ─────────────────────────────────────────────
function saveColaborador(d) {
  return upsertById_('colaboradores', {
    id: d.id || '',
    nome: d.nome || '',
    cargo: d.cargo || '',
    telefone: d.telefone || '',
    horaInicio: d.horaInicio || '08:00',
    horaFim: d.horaFim || '18:00',
    ativo: normalizeBoolStr(d.ativo, 'true')
  });
}

// ── Serviços ──────────────────────────────────────────────────
function saveServico(d) {
  return upsertById_('servicos', {
    id: d.id || '',
    nome: d.nome || '',
    descricao: d.descricao || '',
    duracaoMin: parseInt(d.duracaoMin || 60, 10),
    ativo: normalizeBoolStr(d.ativo, 'true')
  });
}

// ── Produtos ──────────────────────────────────────────────────
function saveProduto(d) {
  return upsertById_('produtos', {
    id: d.id || '',
    nome: d.nome || '',
    preco: normalizeNumber(d.preco),
    descricao: d.descricao || '',
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
  return upsertById_('clientes', {
    id: d.id || '',
    nome: d.nome || '',
    telefone: d.telefone || '',
    email: d.email || '',
    aniversario: d.aniversario || '',
    observacoes: d.observacoes || ''
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
  const data = e.parameter.data || today();
  return caixaDiaList_(data);
}

function getCaixaResumo(e) {
  const data = e.parameter.data || today();
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
  const dataLanc = toISO(d.data || today());
  const ret = upsertByIdUnlocked_('caixa', {
    id: d.id || '',
    data: dataLanc,
    tipo: d.tipo || 'entrada',
    categoria: d.categoria || '',
    clienteId: d.clienteId || '',
    clienteNome: d.clienteNome || '',
    itemId: d.itemId || '',
    itemNome: d.itemNome || '',
    itemTipo: d.itemTipo || '',
    valor: normalizeNumber(d.valor),
    formaPagamento: d.formaPagamento || 'dinheiro',
    observacoes: d.observacoes || '',
    isRetirada: d.isRetirada ? 'true' : 'false'
  });

  invalidateCaixaCaches_(dataLanc);
  return ret;
}

function saveLancamento(d) {
  return withDocumentLock_(() => saveLancamentoUnlocked_(d));
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

  if (e.parameter.dataInicio && e.parameter.dataFim) {
    const di = e.parameter.dataInicio;
    const df = e.parameter.dataFim;
    list = list.filter(r => {
      const d = normDate(r.data);
      return d >= di && d <= df;
    });
    label = `${fmtBR(di)} a ${fmtBR(df)}`;
  } else {
    const mes = parseInt(e.parameter.mes || (new Date().getMonth() + 1), 10);
    const ano = parseInt(e.parameter.ano || new Date().getFullYear(), 10);

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

function saveLancamentoFiado(d) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const entradaValor = normalizeNumber(d.valorEntrada);
    const valorTotal = normalizeNumber(d.valorTotal);
    const numParcelas = parseInt(d.numParcelas || 1, 10);
    const saldo = Math.max(0, valorTotal - entradaValor);
    const valorParcela = numParcelas > 0 ? saldo / numParcelas : 0;
    const credId = uid('cred');
    const timestamp = nowIso();

    if (entradaValor > 0) {
      saveLancamentoUnlocked_({
        tipo: 'entrada',
        clienteId: d.clienteId,
        clienteNome: d.clienteNome,
        itemId: d.itemId || '',
        itemNome: d.itemNome || '',
        itemTipo: d.itemTipo || '',
        valor: entradaValor,
        formaPagamento: d.formaEntrada || 'dinheiro',
        observacoes: 'Entrada fiado',
        data: toISO(d.data || today())
      });
    }

    const credRow = [[
      credId,
      d.clienteId || '',
      d.clienteNome || '',
      'parcelado',
      valorTotal,
      entradaValor,
      saldo,
      numParcelas,
      valorParcela,
      saldo <= 0 ? 'quitado' : 'aberto',
      d.observacoes || '',
      timestamp,
      '',
      ''
    ]];
    insertRowsBatch_('crediario', credRow);

    const vencimentos = d.vencimentos || [];
    const movRows = [];
    for (let i = 0; i < numParcelas; i++) {
      movRows.push([
        uid('mov'),
        credId,
        d.clienteId || '',
        d.clienteNome || '',
        'parcela',
        valorParcela,
        i + 1,
        toISO(vencimentos[i] || ''),
        'aberto',
        '',
        timestamp,
        '',
        ''
      ]);
    }
    insertRowsBatch_('crediario_mov', movRows);

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
    const valor = normalizeNumber(b.valor);
    const parcela = String(b.parcela || '');
    const observacoes = b.observacoes || '';

    const rowNum = rowNumForId_('crediario', crediarioId);
    if (!rowNum) return { error: 'Crediário não encontrado' };

    const s = getSheet('crediario');
    const row = s.getRange(rowNum, 1, 1, SCHEMAS.crediario.length).getValues()[0];
    const saldoAtual = normalizeNumber(row[6]);
    const novoSaldo = Math.max(0, saldoAtual - valor);
    const status = novoSaldo <= 0 ? 'quitado' : 'aberto';

    s.getRange(rowNum, 7).setValue(novoSaldo);
    s.getRange(rowNum, 10).setValue(status);
    s.getRange(rowNum, 13).setValue(nowIso());

    if (parcela) {
      const movSheet = getSheet('crediario_mov');
      const data = sheetData_('crediario_mov');
      const headers = data.headers;
      const rows = data.rows;
      const colCred = headers.indexOf('crediarioId');
      const colParc = headers.indexOf('numParcela');
      const colStatus = headers.indexOf('status');
      const colObs = headers.indexOf('observacoes');
      const colUpd = headers.indexOf('atualizadoEm');

      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][colCred]) === crediarioId && String(rows[i][colParc]) === parcela && !rows[i][headers.indexOf('deletadoEm')]) {
          movSheet.getRange(i + 2, colStatus + 1).setValue('pago');
          movSheet.getRange(i + 2, colObs + 1).setValue(observacoes);
          if (colUpd >= 0) movSheet.getRange(i + 2, colUpd + 1).setValue(nowIso());
          break;
        }
      }
      invalidateSheetCache_('crediario_mov');
    }

    saveLancamentoUnlocked_({
      tipo: 'entrada',
      clienteId: row[1],
      clienteNome: row[2],
      valor: valor,
      formaPagamento: b.formaPagamento || 'dinheiro',
      observacoes: `Receb. fiado parc.${parcela || ''}`,
      data: toISO(b.data || today())
    });

    invalidateSheetCache_('crediario');
    return { saldo: novoSaldo, status: status };
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
    s.getRange(rowNum, headers.indexOf('deletadoEm') + 1).setValue(ts);
    s.getRange(rowNum, headers.indexOf('atualizadoEm') + 1).setValue(ts);

    // cascata: marca as parcelas (crediario_mov) deste fiado como excluídas
    const movSheet = getSheet('crediario_mov');
    const d = sheetData_('crediario_mov');
    const colCred = d.headers.indexOf('crediarioId');
    const colDel = d.headers.indexOf('deletadoEm');
    for (let i = 0; i < d.rows.length; i++) {
      if (String(d.rows[i][colCred]) === String(id) && !d.rows[i][colDel]) {
        movSheet.getRange(i + 2, colDel + 1).setValue(ts);
      }
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

  if (e.parameter.data) {
    list = list.filter(a => normDate(a.data) === e.parameter.data);
  }
  if (e.parameter.dataInicio && e.parameter.dataFim) {
    const di = e.parameter.dataInicio;
    const df = e.parameter.dataFim;
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

function saveAgendamento(d) {
  return upsertById_('agendamentos', {
    id: d.id || '',
    data: toISO(d.data || today()),
    hora: d.hora || '09:00',
    duracaoMin: parseInt(d.duracaoMin || 60, 10),
    clienteId: d.clienteId || '',
    clienteNome: d.clienteNome || '',
    colaboradorId: d.colaboradorId || '',
    colaboradorNome: d.colaboradorNome || '',
    servicos: d.servicos || '',
    valor: normalizeNumber(d.valor),
    status: d.status || 'agendado',
    observacoes: d.observacoes || ''
  });
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
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const id = d.id || uid('plan');
    const numParcelas = parseInt(d.numParcelas || 1, 10);
    const valorTotal = normalizeNumber(d.valorTotal);
    const valorParcela = numParcelas > 0 ? valorTotal / numParcelas : 0;
    const timestamp = nowIso();

    const existing = d.id ? rowNumForId_('planejamento', d.id) : null;
    if (existing) {
      return { error: 'Edição de planejamento existente não suportada nesta versão. Exclua e recrie.' };
    }

    insertRowsBatch_('planejamento', [[
      id,
      d.tipo || 'despesa',
      d.descricao || '',
      valorTotal,
      numParcelas,
      valorParcela,
      parseInt(d.diaVencimento || 1, 10),
      toISO(d.dataInicio || today()),
      'ativo',
      d.observacoes || '',
      timestamp,
      '',
      ''
    ]]);

    const base = new Date(toISO(d.dataInicio || today()) + 'T00:00:00');
    const rowsToInsert = [];
    for (let i = 0; i < numParcelas; i++) {
      const venc = new Date(base);
      venc.setMonth(venc.getMonth() + i);
      venc.setDate(parseInt(d.diaVencimento || venc.getDate(), 10));

      rowsToInsert.push([
        uid('pp'),
        id,
        d.descricao || '',
        d.tipo || 'despesa',
        valorParcela,
        Utilities.formatDate(venc, tz(), 'yyyy-MM-dd'),
        'aberto',
        'false',
        '',
        '',
        timestamp,
        '',
        ''
      ]);
    }

    insertRowsBatch_('plan_parcelas', rowsToInsert);
    return { id: id };
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
    s.getRange(rowNum, 8).setValue('true');     // pago
    s.getRange(rowNum, 7).setValue('pago');     // status
    s.getRange(rowNum, 9).setValue(b.dataPagamento || today());    // dataPagamento
    s.getRange(rowNum, 10).setValue(b.observacoes || '');
    s.getRange(rowNum, 12).setValue(nowIso());  // atualizadoEm

    invalidateSheetCache_('plan_parcelas');

    if (String(row[3]) === 'despesa' && b.registrarCaixa !== false) {
      saveLancamentoUnlocked_({
        tipo: 'saida',
        categoria: b.categoria || 'Obrigação programada',
        itemId: parcelaId,
        itemNome: row[2] || 'Obrigação',
        itemTipo: 'planejamento',
        valor: normalizeNumber(row[4]),
        formaPagamento: b.formaPagamento || 'dinheiro',
        observacoes: b.observacoes || 'Baixa de obrigação programada',
        data: b.dataPagamento || today()
      });
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
  const di = e.parameter.dataInicio || today();
  const df = e.parameter.dataFim || (function () {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
  })();

  const parcelas = getCachedRows_('plan_parcelas')
    .filter(p => p.pago !== 'true' && p.vencimento >= di && p.vencimento <= df)
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
    .filter(p => p.pago !== 'true' && p.vencimento < td)
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
      p.pago !== 'true' &&
      p.status !== 'pago' &&
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
  return softDelete_(sheetName, id);
}

// ── Routers ───────────────────────────────────────────────────
function doGet(e) {
  try {
    ensureSheetsOnce_();

    const a =e.parameter.action;
    const t = e.parameter.token;

    if (a === 'login') return authLogic(e.parameter.senha);
    if (!validateToken(t)) return err('Sessão expirada.');

    switch (a) {
      case 'getConfig':           return ok(getConfigObj());
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
  } catch (e2) {
    return err('Erro interno: ' + e2.message);
  }
}

function doPost(e) {
  try {
    ensureSheets();

    let b = {};
    try { b = JSON.parse(e.postData.contents || '{}'); } catch (_) {}

    const a = b.action;
    const t = b.token;

    if (a === 'login') return authLogic(b.senha);
    if (!validateToken(t)) return err('Sessão expirada.');

    switch (a) {
      case 'saveColaborador':    return result(saveColaborador(b.data));
      case 'saveServico':        return result(saveServico(b.data));
      case 'saveProduto':        return result(saveProduto(b.data));
      case 'saveCliente':        return result(saveCliente(b.data));
      case 'saveLancamento':     return result(saveLancamento(b.data));
      case 'saveAgendamento':    return result(saveAgendamento(b.data));
      case 'savePlanejamento':   return result(savePlanejamento(b.data));
      case 'pagarParcela':       return result(pagarParcela(b));
      case 'saveFiado':          return result(saveLancamentoFiado(b.data));
      case 'pagarCrediario':     return result(pagarCrediario(b));
      case 'updateConfig':       return result(updateConfig(b.config));
      case 'verificarSenha':     return ok({ valido: validateSenha(b.senha) });
      case 'deleteRow':          return result(deleteRow(b.sheet, b.id));
      case 'deleteAgendamento':  return result(deleteRow('agendamentos', b.id));
      case 'deleteLancamento':   return result(deleteRow('caixa', b.id));
      case 'deleteCrediario':    return result(deleteCrediario(b.id));
      default: return err('Ação desconhecida: ' + a);
    }
  } catch (e2) {
    return err('Erro interno: ' + e2.message);
  }
}
