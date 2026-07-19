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
const WHATSAPP_ACCESS_TOKEN_KEY = 'whatsapp_access_token';
const REMINDER_HANDLER = 'processarLembretesAutomaticos_';
const DEFAULT_REMINDER_MESSAGE = 'Olá, {nome}! Lembramos que seu atendimento de {servico} na {salao} está marcado para hoje, {data}, às {hora}. Responda a esta mensagem para confirmar seu horário. Até breve!';
const SHEETS_SCHEMA_VERSION = '5';
const SHEETS_SCHEMA_VERSION_KEY = 'sheets_schema_version';

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
    'id','nome','telefone','email','aniversario','observacoes','criadoEm','atualizadoEm','deletadoEm',
    'naoContatar'
  ],
  agendamentos: [
    'id','data','hora','duracaoMin','clienteId','clienteNome','colaboradorId',
    'colaboradorNome','servicos','valor','status','observacoes','criadoEm','atualizadoEm','deletadoEm',
    'retornoRecomendado','retornoMotivo','oportunidadeId'
  ],
  caixa: [
    'id','data','tipo','categoria','clienteId','clienteNome',
    'itemId','itemNome','itemTipo','valor','formaPagamento',
    'observacoes','isRetirada','criadoEm','atualizadoEm','deletadoEm',
    'dreCategoria'
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
  ],
  relacionamento: [
    'id','clienteId','clienteNome','origem','referenciaId','campanhaId','dataAlvo','etapa',
    'telefoneContato','mensagemContato','contatadaEm','respondeuEm','agendamentoId',
    'agendouEm','retornouEm','recuperacaoAoContatar','encerramentoMotivo','observacoes',
    'criadoEm','atualizadoEm','deletadoEm'
  ],
  relacionamento_eventos: [
    'id','idempotencyKey','oportunidadeId','clienteId','tipo','etapaAnterior','etapaNova',
    'origemAlteracao','dataHora','telefone','mensagem','observacoes',
    'criadoEm','atualizadoEm','deletadoEm'
  ],
  campanhas: [
    'id','nome','mensagemModelo','dataInicio','dataFim','criteriosJson','status',
    'criadoEm','atualizadoEm','deletadoEm'
  ],
  lembretes_envios: [
    'id','idempotencyKey','agendamentoId','clienteId','tipo','agendamentoData',
    'agendamentoHora','programadoPara','telefone','mensagem','status','tentativas',
    'providerMessageId','ultimoErro','enviadoEm','criadoEm','atualizadoEm','deletadoEm'
  ],
  dre_mapeamento: [
    'id','tipo','categoriaCaixa','itemTipo','dreCategoria','ativo',
    'criadoEm','atualizadoEm','deletadoEm'
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

function cleanId_(value, maxLength) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (id.length > (maxLength || 160) || !/^[A-Za-z0-9:_-]+$/.test(id)) {
    throw new Error('Identificador inválido. Atualize a tela e tente novamente.');
  }
  return id;
}

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

function ensureSheetSchema_(name, sheet) {
  const expected = SCHEMAS[name];
  if (!expected) throw new Error('Schema desconhecido: ' + name);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
    styleHeader_(sheet, expected.length);
    return;
  }
  const current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(value => String(value || '').trim());
  const missing = expected.filter(header => current.indexOf(header) < 0);
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    styleHeader_(sheet, current.length + missing.length);
  }
}

function ensureSheets() {
  Object.keys(SCHEMAS).forEach(name => {
    const s = getSheet(name);
    ensureSheetSchema_(name, s);
  });

  ensureConfigDefaults_();
}

// Roda a verificação de abas no máximo 1x por período — antes rodava em TODA chamada e deixava tudo lento
function ensureSheetsOnce_() {
  const cacheKey = 'sheets_ok_' + SHEETS_SCHEMA_VERSION;
  if (CACHE.get(cacheKey)) return;
  if (SCRIPT_PROPS.getProperty(SHEETS_SCHEMA_VERSION_KEY) === SHEETS_SCHEMA_VERSION) {
    CACHE.put(cacheKey, '1', 21600);
    return;
  }
  ensureSheets();
  SCRIPT_PROPS.setProperty(SHEETS_SCHEMA_VERSION_KEY, SHEETS_SCHEMA_VERSION);
  CACHE.put(cacheKey, '1', 21600);
}

function ensureConfigDefaults_() {
  const cfg = getSheet('config');
  const defaults = {
    salonName: 'Sonia Cabral',
    horaInicio: '08:00',
    horaFim: '18:00',
    intervaloMin: '30',
    tokenTTL: '2592000',
    lembreteAutomaticoAtivo: 'false',
    lembreteAntecedenciaHoras: '4',
    lembreteMensagemModelo: DEFAULT_REMINDER_MESSAGE,
    whatsappTemplateName: 'lembrete_agendamento',
    whatsappTemplateLanguage: 'pt_BR',
    whatsappApiVersion: 'v23.0',
    whatsappPhoneNumberId: ''
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
  const idx = Object.create(null);

  if (lastRow >= 2) {
    const ids = s.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const duplicados = Object.create(null);
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
  ['idx_' + sheetName, 'rows_' + sheetName, 'cfg_obj'].forEach(function (key) {
    try { CACHE.remove(key); } catch (_) { /* cache é otimização; nunca invalida uma gravação concluída */ }
  });
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
  try { id = cleanId_(id); } catch (_) { return null; }
  if (!id) return null;
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

function triggerLembretesAtivo_() {
  try {
    return ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === REMINDER_HANDLER;
    });
  } catch (_) {
    return false;
  }
}

function getLembretesConfig_() {
  const cfg = getConfigObj();
  const tokenConfigured = !!SCRIPT_PROPS.getProperty(WHATSAPP_ACCESS_TOKEN_KEY);
  const active = String(cfg.lembreteAutomaticoAtivo || 'false') === 'true';
  const templateName = String(cfg.whatsappTemplateName || 'lembrete_agendamento');
  const phoneNumberId = String(cfg.whatsappPhoneNumberId || '');
  return {
    ativo:active,
    antecedenciaHoras:parseInt(cfg.lembreteAntecedenciaHoras || '4', 10) === 3 ? 3 : 4,
    mensagemModelo:String(cfg.lembreteMensagemModelo || DEFAULT_REMINDER_MESSAGE).slice(0, 2000),
    templateName:templateName,
    templateLanguage:String(cfg.whatsappTemplateLanguage || 'pt_BR'),
    apiVersion:String(cfg.whatsappApiVersion || 'v23.0'),
    phoneNumberId:phoneNumberId,
    tokenConfigurado:tokenConfigured,
    pronto:!!(tokenConfigured && templateName && phoneNumberId),
    triggerAtivo:triggerLembretesAtivo_(),
    horaInicio:String(cfg.horaInicio || '08:00'),
    salao:String(cfg.salonName || 'Sonia Cabral')
  };
}

function salvarLembretesConfig_(body) {
  const data = body && body.data ? body.data : (body || {});
  const advance = parseInt(data.antecedenciaHoras, 10);
  if ([3,4].indexOf(advance) < 0) return { error:'Escolha 3 ou 4 horas de antecedência.' };
  const message = cleanText_(data.mensagemModelo || DEFAULT_REMINDER_MESSAGE, 2000);
  if (!message) return { error:'Informe a mensagem padrão.' };
  const allowedVariables = { '{nome}':true, '{servico}':true, '{salao}':true, '{data}':true, '{hora}':true };
  const invalidVariable = (message.match(/\{[^{}]+\}/g) || []).find(function (variable) {
    return !allowedVariables[variable];
  });
  if (invalidVariable) return { error:'Variável não permitida na mensagem: ' + invalidVariable };
  const templateName = cleanText_(data.templateName, 120);
  const templateLanguage = cleanText_(data.templateLanguage || 'pt_BR', 20);
  const apiVersion = cleanText_(data.apiVersion || 'v23.0', 20);
  const phoneNumberId = String(data.phoneNumberId || '').replace(/\D/g, '').slice(0, 40);
  if (templateName && !/^[a-z0-9_]+$/.test(templateName)) return { error:'Nome do modelo inválido.' };
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(templateLanguage)) return { error:'Idioma do modelo inválido.' };
  if (!/^v\d+\.\d+$/.test(apiVersion)) return { error:'Versão da API inválida.' };
  const token = String(data.accessToken || '').trim();
  if (token) SCRIPT_PROPS.setProperty(WHATSAPP_ACCESS_TOKEN_KEY, token);
  if (data.removerToken === true) SCRIPT_PROPS.deleteProperty(WHATSAPP_ACCESS_TOKEN_KEY);
  const active = data.ativo === true || String(data.ativo).toLowerCase() === 'true';
  if (active && (!templateName || !phoneNumberId || !SCRIPT_PROPS.getProperty(WHATSAPP_ACCESS_TOKEN_KEY))) {
    return { error:'Configure o ID do número, o modelo aprovado e o token antes de ativar.' };
  }
  updateConfigValues_({
    lembreteAutomaticoAtivo:active ? 'true' : 'false',
    lembreteAntecedenciaHoras:String(advance),
    lembreteMensagemModelo:message,
    whatsappTemplateName:templateName,
    whatsappTemplateLanguage:templateLanguage,
    whatsappApiVersion:apiVersion,
    whatsappPhoneNumberId:phoneNumberId
  });
  if (typeof configurarTriggerLembretes_ === 'function') configurarTriggerLembretes_(active);
  return getLembretesConfig_();
}

function listarLembretesEnvios_(params) {
  params = params || {};
  const limit = Math.min(200, Math.max(1, parseInt(params.limite || 50, 10) || 50));
  return getCachedRows_('lembretes_envios')
    .sort(function (a, b) { return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')); })
    .slice(0, limit);
}

function listarClientesTelefonePendente_() {
  return getCachedRows_('clientes').filter(function (client) {
    return client.naoContatar !== 'true' && !normalizarTelefoneWhatsApp_(client.telefone);
  }).map(function (client) {
    return { id:client.id, nome:client.nome, telefone:client.telefone || '' };
  });
}

function cancelarLembretesAgendamentoUnlocked_(appointmentId, reason) {
  let total = 0;
  getCachedRows_('lembretes_envios').filter(function (item) {
    return String(item.agendamentoId) === String(appointmentId) &&
      ['pendente','erro','enviando'].indexOf(String(item.status)) >= 0;
  }).forEach(function (item) {
    const saved = upsertByIdUnlocked_('lembretes_envios', Object.assign({}, item, {
      status:'cancelado',
      ultimoErro:cleanText_(reason || 'agendamento_inativo', 500)
    }));
    if (!saved.error) total += 1;
  });
  return { total:total };
}

function garantirLembreteAgendamentoUnlocked_(appointment) {
  appointment = appointment || {};
  const config = getLembretesConfig_();
  if (!config.ativo || !config.pronto || appointment.status !== 'agendado') {
    return { skipped:true, motivo:'automacao_inativa' };
  }
  const client = getCachedRows_('clientes').find(function (item) {
    return String(item.id) === String(appointment.clienteId);
  });
  if (!client || client.naoContatar === 'true') return { skipped:true, motivo:'cliente_bloqueada' };
  const phone = normalizarTelefoneWhatsApp_(client.telefone);
  if (!phone) return { skipped:true, motivo:'telefone_invalido' };
  const scheduledFor = calcularProgramacaoLembrete_(appointment, {
    horaInicio:config.horaInicio,
    antecedenciaHoras:config.antecedenciaHoras
  });
  const idempotencyKey = chaveLembreteAgendamento_(appointment);
  if (!scheduledFor || !idempotencyKey) return { skipped:true, motivo:'horario_inelegivel' };

  getCachedRows_('lembretes_envios').filter(function (item) {
    return String(item.agendamentoId) === String(appointment.id) &&
      String(item.idempotencyKey) !== idempotencyKey &&
      ['pendente','erro','enviando'].indexOf(String(item.status)) >= 0;
  }).forEach(function (item) {
    upsertByIdUnlocked_('lembretes_envios', Object.assign({}, item, {
      status:'cancelado', ultimoErro:'agendamento_reprogramado'
    }));
  });

  const message = renderizarMensagemLembrete_(config.mensagemModelo, {
    nome:client.nome || appointment.clienteNome,
    servico:appointment.servicos || 'seu atendimento',
    salao:config.salao,
    data:fmtBR(normDate(appointment.data)),
    hora:String(appointment.hora || '').slice(0, 5)
  });
  const queueData = {
    idempotencyKey:idempotencyKey,
    agendamentoId:appointment.id,
    clienteId:appointment.clienteId,
    tipo:'lembrete_agendamento',
    agendamentoData:normDate(appointment.data),
    agendamentoHora:String(appointment.hora || '').slice(0, 5),
    programadoPara:scheduledFor,
    telefone:phone,
    mensagem:cleanText_(message, 2000),
    status:'pendente',
    tentativas:0,
    providerMessageId:'',
    ultimoErro:'',
    enviadoEm:''
  };
  const existing = getCachedRows_('lembretes_envios').find(function (item) {
    return String(item.idempotencyKey) === idempotencyKey;
  });
  if (existing) {
    if (existing.status === 'cancelado') {
      const reactivated = upsertByIdUnlocked_('lembretes_envios', Object.assign({}, existing, queueData, {
        id:existing.id
      }));
      if (reactivated.error) return reactivated;
      reactivated.reactivated = true;
      return reactivated;
    }
    if (['pendente','erro'].indexOf(String(existing.status)) >= 0) {
      const refreshed = upsertByIdUnlocked_('lembretes_envios', Object.assign({}, existing, queueData, {
        id:existing.id,
        status:existing.status,
        tentativas:existing.tentativas || 0,
        ultimoErro:existing.ultimoErro || ''
      }));
      if (refreshed.error) return refreshed;
      refreshed.duplicate = true;
      return refreshed;
    }
    return { id:existing.id, item:existing, duplicate:true };
  }
  return upsertByIdUnlocked_('lembretes_envios', queueData);
}

function sanitizarErroWhatsApp_(error, accessToken) {
  let message = error && error.message ? error.message : String(error || 'Falha desconhecida no WhatsApp.');
  const token = String(accessToken || '');
  if (token) message = message.split(token).join('[credencial protegida]');
  message = message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credencial protegida]');
  return cleanText_(message, 500);
}

function respostaJsonWhatsApp_(response) {
  const code = Number(response.getResponseCode());
  const text = String(response.getContentText() || '');
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw:text.slice(0, 500) }; }
  return { code:code, body:body };
}

function enviarTemplateWhatsApp_(reminder, appointment, client, config) {
  const accessToken = SCRIPT_PROPS.getProperty(WHATSAPP_ACCESS_TOKEN_KEY);
  if (!accessToken) throw new Error('Token do WhatsApp não configurado.');
  const endpoint = 'https://graph.facebook.com/' + config.apiVersion + '/' + config.phoneNumberId + '/messages';
  const parameters = [
    client && client.nome || appointment.clienteNome || 'Cliente',
    appointment.servicos || 'seu atendimento',
    config.salao || 'Sonia Cabral',
    fmtBR(normDate(appointment.data)),
    String(appointment.hora || '').slice(0, 5)
  ].map(function (value) { return { type:'text', text:String(value) }; });
  const payload = {
    messaging_product:'whatsapp',
    recipient_type:'individual',
    to:reminder.telefone,
    type:'template',
    template:{
      name:config.templateName,
      language:{ code:config.templateLanguage },
      components:[{ type:'body', parameters:parameters }]
    }
  };
  let parsed;
  try {
    parsed = respostaJsonWhatsApp_(UrlFetchApp.fetch(endpoint, {
      method:'post',
      contentType:'application/json',
      headers:{ Authorization:'Bearer ' + accessToken },
      payload:JSON.stringify(payload),
      muteHttpExceptions:true
    }));
  } catch (fetchError) {
    throw new Error(sanitizarErroWhatsApp_(fetchError, accessToken));
  }
  const providerId = parsed.body && parsed.body.messages && parsed.body.messages[0] && parsed.body.messages[0].id;
  if (parsed.code < 200 || parsed.code >= 300 || !providerId) {
    const providerError = parsed.body && parsed.body.error && parsed.body.error.message ||
      parsed.body && parsed.body.raw || 'Resposta sem identificador da mensagem.';
    throw new Error(sanitizarErroWhatsApp_('WhatsApp HTTP ' + parsed.code + ': ' + providerError, accessToken));
  }
  return { id:String(providerId), code:parsed.code };
}

function configurarTriggerLembretes_(active) {
  const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === REMINDER_HANDLER;
  });
  if (!active) {
    triggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    return { ativo:false, total:0 };
  }
  triggers.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  if (!triggers.length) {
    ScriptApp.newTrigger(REMINDER_HANDLER).timeBased().everyMinutes(15).create();
  }
  return { ativo:true, total:1 };
}

function testarWhatsAppConfig_() {
  const config = getLembretesConfig_();
  const accessToken = SCRIPT_PROPS.getProperty(WHATSAPP_ACCESS_TOKEN_KEY);
  if (!config.pronto || !accessToken) return { error:'Preencha e salve as credenciais do WhatsApp antes de testar.' };
  const endpoint = 'https://graph.facebook.com/' + config.apiVersion + '/' + config.phoneNumberId +
    '?fields=id,display_phone_number,verified_name';
  let parsed;
  try {
    parsed = respostaJsonWhatsApp_(UrlFetchApp.fetch(endpoint, {
      method:'get',
      headers:{ Authorization:'Bearer ' + accessToken },
      muteHttpExceptions:true
    }));
  } catch (fetchError) {
    return { error:sanitizarErroWhatsApp_(fetchError, accessToken) };
  }
  if (parsed.code < 200 || parsed.code >= 300 || !parsed.body.id) {
    const providerError = parsed.body && parsed.body.error && parsed.body.error.message || 'Não foi possível validar o número.';
    return { error:sanitizarErroWhatsApp_('WhatsApp HTTP ' + parsed.code + ': ' + providerError, accessToken) };
  }
  return {
    ok:true,
    phoneNumberId:String(parsed.body.id),
    numero:String(parsed.body.display_phone_number || ''),
    nomeVerificado:String(parsed.body.verified_name || '')
  };
}

function processarLembretesAutomaticos_(nowOverride) {
  const config = getLembretesConfig_();
  if (!config.ativo || !config.pronto) {
    return { skipped:true, motivo:'automacao_inativa', enviados:0, erros:0, expirados:0 };
  }
  const current = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(String(nowOverride || '')) ?
    String(nowOverride) : nowIso();
  const currentDate = current.slice(0, 10);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let reconciled = 0;
    getCachedRows_('agendamentos').filter(function (appointment) {
      return appointment.status === 'agendado' && normDate(appointment.data) === currentDate;
    }).forEach(function (appointment) {
      const result = garantirLembreteAgendamentoUnlocked_(appointment);
      if (result && !result.skipped) reconciled += 1;
    });

    const summary = { reconciliados:reconciled, enviados:0, erros:0, expirados:0, cancelados:0 };
    getCachedRows_('lembretes_envios').filter(function (reminder) {
      return ['pendente','erro'].indexOf(String(reminder.status)) >= 0 &&
        Number(reminder.tentativas || 0) < 3 &&
        String(reminder.programadoPara || '') <= current &&
        String(reminder.agendamentoData || '').slice(0, 10) <= currentDate;
    }).forEach(function (reminder) {
      const appointment = getCachedRows_('agendamentos').find(function (item) {
        return String(item.id) === String(reminder.agendamentoId);
      });
      if (!appointment || appointment.status !== 'agendado') {
        upsertByIdUnlocked_('lembretes_envios', Object.assign({}, reminder, {
          status:'cancelado', ultimoErro:'agendamento_inativo'
        }));
        summary.cancelados += 1;
        return;
      }
      const appointmentStart = normDate(appointment.data) + 'T' + String(appointment.hora || '').slice(0, 5) + ':00';
      if (current >= appointmentStart) {
        upsertByIdUnlocked_('lembretes_envios', Object.assign({}, reminder, {
          status:'expirado', ultimoErro:'horario_do_atendimento_atingido'
        }));
        summary.expirados += 1;
        return;
      }
      const client = getCachedRows_('clientes').find(function (item) {
        return String(item.id) === String(appointment.clienteId);
      });
      const attempts = Number(reminder.tentativas || 0) + 1;
      upsertByIdUnlocked_('lembretes_envios', Object.assign({}, reminder, {
        status:'enviando', tentativas:attempts, ultimoErro:''
      }));
      try {
        const sent = enviarTemplateWhatsApp_(reminder, appointment, client, config);
        upsertByIdUnlocked_('lembretes_envios', Object.assign({}, reminder, {
          status:'enviado', tentativas:attempts, providerMessageId:sent.id,
          ultimoErro:'', enviadoEm:current
        }));
        summary.enviados += 1;
      } catch (sendError) {
        upsertByIdUnlocked_('lembretes_envios', Object.assign({}, reminder, {
          status:'erro', tentativas:attempts,
          ultimoErro:sanitizarErroWhatsApp_(sendError, SCRIPT_PROPS.getProperty(WHATSAPP_ACCESS_TOKEN_KEY))
        }));
        summary.erros += 1;
      }
    });
    return summary;
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

function setPasswordHash_(password, allowLegacyShortPassword) {
  const value = String(password || '');
  if (value.length < 8 && !allowLegacyShortPassword) throw new Error('A senha deve ter pelo menos 8 caracteres.');
  if (value.length > 256) throw new Error('A senha deve ter no máximo 256 caracteres.');
  const salt = Utilities.getUuid().replace(/-/g, '');
  SCRIPT_PROPS.setProperties({
    [PASSWORD_SALT_KEY]: salt,
    [PASSWORD_HASH_KEY]: passwordHash_(value, salt)
  });
}

function verifyPassword_(password, migrateLegacy) {
  if (String(password || '').length > 256) return false;
  const salt = SCRIPT_PROPS.getProperty(PASSWORD_SALT_KEY);
  const storedHash = SCRIPT_PROPS.getProperty(PASSWORD_HASH_KEY);
  if (salt && storedHash) return constantTimeEqual_(storedHash, passwordHash_(password, salt));

  const cfg = getConfigObj();
  const legacy = String(cfg.senha || '');
  const validLegacy = !!legacy && constantTimeEqual_(legacy, String(password || ''));
  if (validLegacy && migrateLegacy !== false) {
    setPasswordHash_(String(password), true);
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

function registerLoginFailureUnlocked_() {
  const current = getLoginFailures_();
  const count = (parseInt(current.count, 10) || 0) + 1;
  CACHE.put(LOGIN_FAILURE_KEY, JSON.stringify({ count: count }), 300);
  return count;
}

function registerLoginFailure_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try { return registerLoginFailureUnlocked_(); }
  finally { lock.releaseLock(); }
}

function clearLoginFailures_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    try { CACHE.remove(LOGIN_FAILURE_KEY); } catch (_) { /* não bloquear login válido por falha de cache */ }
  }
  finally { lock.releaseLock(); }
}

function authLogic(senha, lembrar) {
  const shouldThrottle = (getLoginFailures_().count || 0) >= 5;
  const throttleLock = shouldThrottle ? LockService.getScriptLock() : null;
  let validPassword = false;
  let failureCount = 0;

  if (throttleLock) throttleLock.waitLock(30000);
  try {
    // Depois do limite, uma única tentativa por vez atravessa esta espera.
    // A senha correta ainda entra após o atraso, evitando bloqueio administrativo total.
    if (shouldThrottle) Utilities.sleep(1200);
    validPassword = String(senha || '').length <= 256 && verifyPassword_(senha, true);
    if (!validPassword) {
      failureCount = shouldThrottle ? registerLoginFailureUnlocked_() : registerLoginFailure_();
    } else if (shouldThrottle) {
      try { CACHE.remove(LOGIN_FAILURE_KEY); } catch (_) { /* não bloquear login válido por falha de cache */ }
    }
  } finally {
    if (throttleLock) throttleLock.releaseLock();
  }

  if (!validPassword) {
    if (failureCount >= 5) return err('Muitas tentativas incorretas. Aguarde 5 minutos.');
    return err('Senha incorreta.');
  }
  // A senha correta sempre pode entrar e limpar o contador; assim um atacante
  // não bloqueia o salão inteiro ao errar cinco vezes.
  if (!shouldThrottle) clearLoginFailures_();

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
  if (!/^[0-9a-f-]{36}$/i.test(String(t))) return false;
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
  if (next.length > 256) return { error: 'A nova senha deve ter no máximo 256 caracteres.' };
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
  const providedId = record.id ? cleanId_(record.id) : '';
  const id = providedId || uid(sheetName.slice(0, 3));
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
    if (Object.prototype.hasOwnProperty.call(record, h)) {
      rowObj[h] = h === 'id' || /Id$/.test(h) ? cleanId_(record[h]) : record[h];
    }
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

function getRowObjectById_(sheetName, id) {
  const cleanId = cleanId_(id);
  if (!cleanId) return null;
  const rowNum = rowNumForId_(sheetName, cleanId);
  if (!rowNum) return null;
  const headers = SCHEMAS[sheetName];
  const values = getSheet(sheetName).getRange(rowNum, 1, 1, headers.length).getValues();
  return objectifyRows_(headers, values)[0] || null;
}

function restoreRowObjectUnlocked_(sheetName, snapshot) {
  if (!snapshot || !snapshot.id) return;
  const rowNum = rowNumForId_(sheetName, snapshot.id);
  if (!rowNum) return;
  const headers = SCHEMAS[sheetName];
  getSheet(sheetName).getRange(rowNum, 1, 1, headers.length)
    .setValues([headers.map(header => snapshot[header] == null ? '' : snapshot[header])]);
  invalidateSheetCache_(sheetName);
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
  const email = cleanText_(d.email, 180);
  const aniversario = cleanText_(d.aniversario, 10);
  const telefoneInformado = String(d.telefone || '').trim();
  const telefoneWhatsApp = normalizarTelefoneWhatsApp_(telefoneInformado);
  const telefoneCadastro = telefoneWhatsApp ? telefoneWhatsApp.slice(2) : cleanText_(telefoneInformado, 30);
  if (!nome) return { error: 'Nome da cliente é obrigatório.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Informe um e-mail válido.' };
  if (aniversario && !normalizarDataEstrita_(aniversario)) return { error: 'Informe uma data de aniversário válida.' };
  return upsertById_('clientes', {
    id: d.id || '',
    nome: nome,
    telefone: telefoneCadastro,
    email: email,
    aniversario: aniversario ? fmtBR(normalizarDataEstrita_(aniversario)) : '',
    observacoes: cleanText_(d.observacoes, 1000),
    naoContatar: normalizeBoolStr(d.naoContatar, 'false')
  });
}

// ── Relacionamento ────────────────────────────────────────────
function chaveIdempotenciaRelacionamento_(value) {
  let key = '';
  try { key = cleanId_(value, 160); } catch (_) { return ''; }
  return key.length >= 12 ? key : '';
}

function oportunidadeRelacionamentoPorId_(id) {
  let cleanId = '';
  try { cleanId = cleanId_(id); } catch (_) { return null; }
  return getCachedRows_('relacionamento').find(item => String(item.id) === cleanId) || null;
}

function eventoRelacionamentoPorChave_(idempotencyKey) {
  if (!idempotencyKey) return null;
  return getCachedRows_('relacionamento_eventos')
    .find(item => String(item.idempotencyKey) === String(idempotencyKey)) || null;
}

function listarRelacionamento_(params) {
  params = params || {};
  const clients = getCachedRows_('clientes');
  const campaigns = getCachedRows_('campanhas');
  const appointments = getCachedRows_('agendamentos');
  const clientById = {};
  const campaignById = {};
  const lastAppointmentByClient = {};
  const activeAppointmentIds = {};
  clients.forEach(function (client) { clientById[String(client.id)] = client; });
  campaigns.forEach(function (campaign) { campaignById[String(campaign.id)] = campaign; });
  appointments.forEach(function (appointment) {
    activeAppointmentIds[String(appointment.id)] = true;
  });
  appointments.filter(function (appointment) {
    return appointment.status === 'concluido' && appointment.clienteId;
  }).forEach(function (appointment) {
    const key = String(appointment.clienteId);
    const current = lastAppointmentByClient[key];
    const stamp = String(normDate(appointment.data) || '') + 'T' + String(appointment.hora || '');
    const currentStamp = current
      ? String(normDate(current.data) || '') + 'T' + String(current.hora || '')
      : '';
    if (!current || stamp > currentStamp) lastAppointmentByClient[key] = appointment;
  });

  let list = getCachedRows_('relacionamento').map(function (item) {
    const client = clientById[String(item.clienteId)] || {};
    const lastAppointment = lastAppointmentByClient[String(item.clienteId)] || {};
    const sourceMatch = String(item.referenciaId || '').match(/^retorno:(.+)$/);
    const sourceMissing = item.origem === 'retorno' && sourceMatch && !activeAppointmentIds[sourceMatch[1]];
    const effectiveItem = sourceMissing
      ? Object.assign({}, item, { encerramentoMotivo:'origem_excluida' })
      : item;
    const phone = normalizarTelefoneWhatsApp_(client.telefone);
    const canContact = client.naoContatar !== 'true' && !!phone;
    const baseQueue = filaRelacionamento_(effectiveItem, today());
    let queue = baseQueue;
    if (baseQueue !== 'encerrado' && !canContact) queue = 'inapto';
    else if (baseQueue !== 'encerrado' && item.origem === 'aniversario') queue = 'aniversario';
    else if (baseQueue !== 'encerrado' && item.origem === 'campanha') queue = 'campanha';

    const targetMs = relDateMs_(normDate(item.dataAlvo));
    const todayMs = relDateMs_(today());
    const delay = Number.isFinite(targetMs) && Number.isFinite(todayMs)
      ? Math.max(0, Math.floor((todayMs - targetMs) / 86400000))
      : 0;
    const campaign = campaignById[String(item.campanhaId)] || {};
    let message = '';
    if (item.origem === 'campanha') {
      message = campaign.mensagemModelo || '';
    } else if (item.origem === 'aniversario') {
      message = 'Olá, {nome}! Feliz aniversário! Desejamos um dia muito especial para você.';
    } else {
      message = 'Olá, {nome}! Está chegando a época do seu retorno de {servico}. Vamos agendar?';
    }
    const service = item.observacoes || lastAppointment.servicos || 'seu cuidado';
    message = cleanText_(String(message)
      .replace(/\{nome\}/g, client.nome || item.clienteNome || '')
      .replace(/\{servico\}/g, service)
      .replace(/\{ultimoServico\}/g, lastAppointment.servicos || '')
      .replace(/\{dataAlvo\}/g, fmtBR(normDate(item.dataAlvo))), 2000);

    return Object.assign({}, effectiveItem, {
      fila:queue,
      diasAtraso:delay,
      telefoneWhatsApp:phone,
      telefoneValido:canContact,
      naoContatar:client.naoContatar === 'true',
      ultimoAtendimento:normDate(lastAppointment.data),
      ultimoServico:lastAppointment.servicos || '',
      mensagemSugerida:message
    });
  });
  if (params.etapa) list = list.filter(item => item.etapa === params.etapa);
  if (params.origem) list = list.filter(item => item.origem === params.origem);
  if (params.campanhaId) list = list.filter(item => item.campanhaId === params.campanhaId);
  if (params.fila) list = list.filter(item => item.fila === params.fila);
  if (params.telefoneValido === true || params.telefoneValido === 'true') {
    list = list.filter(item => item.telefoneValido);
  }
  if (params.atrasoMin !== '' && typeof params.atrasoMin !== 'undefined') {
    const minDelay = Math.max(0, parseInt(params.atrasoMin, 10) || 0);
    list = list.filter(item => item.diasAtraso >= minDelay);
  }
  if (!!params.dataInicio !== !!params.dataFim) throw new Error('Informe as duas datas do período.');
  if (params.dataInicio && params.dataFim) {
    const start = toISO(params.dataInicio);
    const end = toISO(params.dataFim);
    if (start > end) throw new Error('Período inválido.');
    list = list.filter(item => item.dataAlvo >= start && item.dataAlvo <= end);
  }
  return list.sort((a, b) =>
    String(a.dataAlvo || '').localeCompare(String(b.dataAlvo || '')) ||
    String(a.clienteNome || '').localeCompare(String(b.clienteNome || ''))
  );
}

function dataAniversarioNoAno_(aniversario, ano) {
  const value = String(aniversario || '').trim();
  let day = 0;
  let month = 0;
  let match = value.match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
  } else {
    match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!match) return '';
    month = parseInt(match[1], 10);
    day = parseInt(match[2], 10);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const lastDay = new Date(Date.UTC(ano, month, 0)).getUTCDate();
  const adjustedDay = Math.min(day, lastDay);
  return String(ano) + '-' + String(month).padStart(2, '0') + '-' + String(adjustedDay).padStart(2, '0');
}

function materializarAniversarios_(ano) {
  const year = parseInt(ano, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error:'Ano de aniversário inválido.' };
  }
  return withDocumentLock_(function () {
    const existingReferences = {};
    getCachedRows_('relacionamento').forEach(function (item) {
      existingReferences[String(item.referenciaId)] = true;
    });
    const createdIds = [];
    getCachedRows_('clientes').forEach(function (client) {
      const targetDate = dataAniversarioNoAno_(client.aniversario, year);
      const reference = 'aniversario:' + client.id + ':' + year;
      if (!targetDate || existingReferences[reference] || client.naoContatar === 'true') return;
      if (!normalizarTelefoneWhatsApp_(client.telefone)) return;
      const saved = upsertByIdUnlocked_('relacionamento', {
        clienteId:client.id,
        clienteNome:cleanText_(client.nome, 120),
        origem:'aniversario',
        referenciaId:reference,
        dataAlvo:targetDate,
        etapa:'pendente'
      });
      if (saved.error) return;
      const event = registrarEventoRelacionamentoUnlocked_({
        idempotencyKey:'auto:aniversario:' + client.id + ':' + year,
        oportunidadeId:saved.id,
        clienteId:client.id,
        tipo:'criacao',
        etapaAnterior:'',
        etapaNova:'pendente',
        origemAlteracao:'automatica',
        observacoes:'Oportunidade anual de aniversário.'
      });
      if (event.error) {
        softDeleteUnlocked_('relacionamento', saved.id);
        return;
      }
      existingReferences[reference] = true;
      createdIds.push(saved.id);
    });
    return { total:createdIds.length, ids:createdIds };
  });
}

function salvarCampanha_(body) {
  const data = body && body.data ? body.data : (body || {});
  return withDocumentLock_(function () {
    const name = cleanText_(data.nome, 120);
    const message = cleanText_(data.mensagemModelo, 2000);
    const status = String(data.status || 'rascunho');
    if (!name) return { error:'Informe o nome da campanha.' };
    if (!message) return { error:'Informe a mensagem da campanha.' };
    if (['rascunho','ativa','encerrada'].indexOf(status) < 0) {
      return { error:'Status da campanha inválido.' };
    }
    let start;
    let end;
    try {
      start = toISO(data.dataInicio || today());
      end = toISO(data.dataFim || start);
    } catch (error) {
      return { error:error.message };
    }
    if (end < start) return { error:'O fim da campanha não pode ser anterior ao início.' };

    let criteria = data.criterios || {};
    if (typeof data.criteriosJson === 'string' && data.criteriosJson.trim()) {
      try {
        criteria = JSON.parse(data.criteriosJson);
      } catch (_) {
        return { error:'Os critérios da campanha são inválidos.' };
      }
    }
    let criteriaJson;
    try {
      criteriaJson = JSON.stringify(criteria || {});
    } catch (_) {
      return { error:'Os critérios da campanha são inválidos.' };
    }
    if (criteriaJson.length > 5000) return { error:'Os critérios da campanha são muito extensos.' };
    return upsertByIdUnlocked_('campanhas', {
      id:data.id || '',
      nome:name,
      mensagemModelo:message,
      dataInicio:start,
      dataFim:end,
      criteriosJson:criteriaJson,
      status:status
    });
  });
}

function gerarOportunidadesCampanha_(body) {
  body = body || {};
  return withDocumentLock_(function () {
    const campaignId = String(body.campanhaId || '');
    const campaign = getCachedRows_('campanhas').find(function (item) {
      return String(item.id) === campaignId;
    });
    if (!campaign || campaign.status !== 'ativa') {
      return { error:'Campanha não encontrada ou inativa.' };
    }
    const requestedIds = Array.isArray(body.clienteIds)
      ? Array.from(new Set(body.clienteIds.map(String).filter(Boolean)))
      : [];
    if (!requestedIds.length) return { error:'Selecione ao menos uma cliente para a campanha.' };
    if (requestedIds.length > 1000) return { error:'Selecione no máximo 1.000 clientes por vez.' };

    const clients = getCachedRows_('clientes');
    const clientById = {};
    clients.forEach(function (client) { clientById[String(client.id)] = client; });
    const unknown = requestedIds.filter(function (id) { return !clientById[id]; });
    if (unknown.length) return { error:'Uma ou mais clientes selecionadas não existem mais.' };

    const existingReferences = {};
    getCachedRows_('relacionamento').forEach(function (item) {
      existingReferences[String(item.referenciaId)] = true;
    });
    const createdIds = [];
    let ignored = 0;
    requestedIds.forEach(function (clientId) {
      const client = clientById[clientId];
      const reference = 'campanha:' + campaign.id + ':' + client.id;
      if (existingReferences[reference] || client.naoContatar === 'true' ||
          !normalizarTelefoneWhatsApp_(client.telefone)) {
        ignored += 1;
        return;
      }
      const saved = upsertByIdUnlocked_('relacionamento', {
        clienteId:client.id,
        clienteNome:cleanText_(client.nome, 120),
        origem:'campanha',
        referenciaId:reference,
        campanhaId:campaign.id,
        dataAlvo:today(),
        etapa:'pendente',
        observacoes:cleanText_(campaign.nome, 1000)
      });
      if (saved.error) {
        ignored += 1;
        return;
      }
      const event = registrarEventoRelacionamentoUnlocked_({
        idempotencyKey:'auto:campanha:' + campaign.id + ':' + client.id,
        oportunidadeId:saved.id,
        clienteId:client.id,
        tipo:'criacao',
        etapaAnterior:'',
        etapaNova:'pendente',
        origemAlteracao:'automatica',
        observacoes:'Cliente incluída na campanha ' + campaign.nome + '.'
      });
      if (event.error) {
        softDeleteUnlocked_('relacionamento', saved.id);
        ignored += 1;
        return;
      }
      existingReferences[reference] = true;
      createdIds.push(saved.id);
    });
    return { total:createdIds.length, ids:createdIds, ignoradas:ignored };
  });
}

function listarEventosRelacionamento_(params) {
  params = params || {};
  let list = getCachedRows_('relacionamento_eventos');
  if (params.oportunidadeId) {
    list = list.filter(item => String(item.oportunidadeId) === String(params.oportunidadeId));
  }
  if (params.clienteId) {
    list = list.filter(item => String(item.clienteId) === String(params.clienteId));
  }
  return list.sort((a, b) => String(a.dataHora || '').localeCompare(String(b.dataHora || '')));
}

function registrarEventoRelacionamentoUnlocked_(data) {
  const idempotencyKey = chaveIdempotenciaRelacionamento_(data && data.idempotencyKey);
  if (!idempotencyKey) return { error: 'Identificador da operação de relacionamento inválido.' };
  const existing = eventoRelacionamentoPorChave_(idempotencyKey);
  if (existing) return { id: existing.id, item: existing, duplicate: true };
  return upsertByIdUnlocked_('relacionamento_eventos', {
    idempotencyKey: idempotencyKey,
    oportunidadeId: data.oportunidadeId,
    clienteId: data.clienteId,
    tipo: cleanText_(data.tipo, 40),
    etapaAnterior: cleanText_(data.etapaAnterior, 30),
    etapaNova: cleanText_(data.etapaNova, 30),
    origemAlteracao: cleanText_(data.origemAlteracao || 'manual', 30),
    dataHora: nowIso(),
    telefone: cleanText_(data.telefone, 30),
    mensagem: cleanText_(data.mensagem, 2000),
    observacoes: cleanText_(data.observacoes, 1000)
  });
}

function atualizarEtapaRelacionamentoUnlocked_(item, etapaNova, meta) {
  meta = meta || {};
  const rank = { pendente:0, contatada:1, respondeu:2, agendou:3, retornou:4 };
  const atual = String(item && item.etapa || 'pendente');
  if (!item || !item.id) return { error: 'Oportunidade não encontrada.' };
  if (!Object.prototype.hasOwnProperty.call(rank, etapaNova)) return { error: 'Etapa inválida.' };
  if (meta.origemAlteracao === 'automatica' && rank[etapaNova] < rank[atual]) {
    return { error: 'A etapa automática não pode retroceder.' };
  }
  const idempotencyKey = chaveIdempotenciaRelacionamento_(meta.idempotencyKey);
  if (!idempotencyKey) return { error: 'Identificador da operação de relacionamento inválido.' };
  const previousEvent = eventoRelacionamentoPorChave_(idempotencyKey);
  if (previousEvent) return { id:item.id, item:item, duplicate:true };

  const stampField = {
    contatada:'contatadaEm',
    respondeu:'respondeuEm',
    agendou:'agendouEm',
    retornou:'retornouEm'
  }[etapaNova];
  const snapshot = Object.assign({}, item);
  const record = Object.assign({}, item, meta.patch || {}, { etapa:etapaNova });
  if (stampField && !record[stampField]) record[stampField] = nowIso();

  const saved = upsertByIdUnlocked_('relacionamento', record);
  if (saved.error) return saved;
  const event = registrarEventoRelacionamentoUnlocked_({
    idempotencyKey:idempotencyKey,
    oportunidadeId:item.id,
    clienteId:item.clienteId,
    tipo:meta.tipo || 'mudanca_etapa',
    etapaAnterior:atual,
    etapaNova:etapaNova,
    origemAlteracao:meta.origemAlteracao || 'manual',
    telefone:meta.telefone,
    mensagem:meta.mensagem,
    observacoes:meta.observacoes
  });
  if (event.error) {
    upsertByIdUnlocked_('relacionamento', snapshot);
    return event;
  }
  return saved;
}

function confirmarContato_(body) {
  body = body || {};
  return withDocumentLock_(() => {
    const item = oportunidadeRelacionamentoPorId_(body.id);
    if (!item) return { error: 'Oportunidade não encontrada.' };
    if (item.encerramentoMotivo) return { error: 'Esta oportunidade já foi encerrada.' };
    const client = getCachedRows_('clientes')
      .find(row => String(row.id) === String(item.clienteId));
    if (!client) return { error: 'Cliente não encontrada.' };
    if (client.naoContatar === 'true') return { error: 'A cliente não deseja receber mensagens.' };
    const phone = normalizarTelefoneWhatsApp_(client.telefone);
    if (!phone) return { error: 'Cadastre um telefone válido antes de contatar.' };
    const message = cleanText_(body.mensagem, 2000);
    if (!message) return { error: 'Informe a mensagem enviada.' };
    const currentRank = REL_ETAPAS_.indexOf(item.etapa);
    const targetStage = currentRank >= REL_ETAPAS_.indexOf('contatada') ? item.etapa : 'contatada';
    return atualizarEtapaRelacionamentoUnlocked_(item, targetStage, {
      idempotencyKey:body.idempotencyKey,
      origemAlteracao:'manual',
      tipo:'contato',
      telefone:phone,
      mensagem:message,
      patch:{
        telefoneContato:phone,
        mensagemContato:message,
        recuperacaoAoContatar:filaRelacionamento_(item, today()) === 'recuperacao' ? 'true' : item.recuperacaoAoContatar || 'false'
      }
    });
  });
}

function salvarEtapaRelacionamento_(body) {
  body = body || {};
  return withDocumentLock_(() => {
    const item = oportunidadeRelacionamentoPorId_(body.id);
    if (!item) return { error: 'Oportunidade não encontrada.' };
    if (item.encerramentoMotivo) return { error: 'Esta oportunidade já foi encerrada.' };
    return atualizarEtapaRelacionamentoUnlocked_(item, String(body.etapa || ''), {
      idempotencyKey:body.idempotencyKey,
      origemAlteracao:'manual',
      observacoes:body.observacoes
    });
  });
}

// ── Caixa ─────────────────────────────────────────────────────
function agendamentoIdDoCaixa_(cash) {
  const match = String(cash && cash.itemId || '').match(/^agcash:([A-Za-z0-9:_-]+)$/);
  return match ? match[1] : '';
}

function caixaVinculadoAoAgendamento_(appointmentId) {
  return findCashByItemId_('agcash:' + String(appointmentId || ''));
}

function sincronizarCaixaComAgendamentoUnlocked_(cash) {
  const appointmentId = agendamentoIdDoCaixa_(cash);
  if (!appointmentId) return { skipped:true };
  const appointment = getCachedRows_('agendamentos').find(function (item) {
    return String(item.id) === appointmentId;
  });
  if (!appointment) return { error:'O agendamento vinculado ao caixa não existe mais.' };
  return saveAgendamentoUnlocked_(Object.assign({}, appointment, {
    clienteId:cash.clienteId || '',
    clienteNome:cleanText_(cash.clienteNome, 120),
    servicos:cleanText_(cash.itemNome, 1000),
    valor:cash.valor
  }));
}

function sincronizarAgendamentoComCaixaUnlocked_(appointment) {
  const cash = caixaVinculadoAoAgendamento_(appointment && appointment.id);
  if (!cash) return { skipped:true };
  return saveLancamentoUnlocked_(Object.assign({}, cash, {
    itemId:'agcash:' + appointment.id,
    itemTipo:'agendamento',
    tipo:'entrada',
    clienteId:appointment.clienteId || '',
    clienteNome:cleanText_(appointment.clienteNome, 120),
    itemNome:cleanText_(appointment.servicos, 500),
    valor:appointment.valor,
    isRetirada:false
  }));
}

function etapaAnteriorDoVinculo_(appointmentId) {
  const event = getCachedRows_('relacionamento_eventos').find(function (item) {
    return String(item.idempotencyKey) === 'auto:agendou:' + String(appointmentId || '');
  });
  return event && ['contatada','respondeu'].indexOf(String(event.etapaAnterior)) >= 0
    ? String(event.etapaAnterior)
    : 'contatada';
}

function deleteAgendamentoVinculadoUnlocked_(id) {
  const appointmentId = cleanId_(id);
  if (!appointmentId) return { error:'Agendamento inválido.' };
  const appointment = getRowObjectById_('agendamentos', appointmentId);
  const cash = caixaVinculadoAoAgendamento_(appointmentId);
  const generatedReturn = getCachedRows_('relacionamento').find(function (item) {
    return item.origem === 'retorno' && String(item.referenciaId) === 'retorno:' + appointmentId;
  });
  const priorOpportunity = appointment && appointment.oportunidadeId
    ? oportunidadeRelacionamentoPorId_(appointment.oportunidadeId)
    : null;
  if (!appointment && !cash && !generatedReturn) return { error:'Agendamento não encontrado.' };

  const snapshots = [
    appointment && { sheet:'agendamentos', item:Object.assign({}, appointment) },
    cash && { sheet:'caixa', item:Object.assign({}, cash) },
    generatedReturn && { sheet:'relacionamento', item:Object.assign({}, generatedReturn) },
    priorOpportunity && { sheet:'relacionamento', item:Object.assign({}, priorOpportunity) }
  ].filter(Boolean);
  const timestamp = nowIso();

  try {
    if (priorOpportunity && String(priorOpportunity.agendamentoId || '') === appointmentId) {
      const previousStage = etapaAnteriorDoVinculo_(appointmentId);
      const restored = upsertByIdUnlocked_('relacionamento', Object.assign({}, priorOpportunity, {
        etapa:previousStage,
        agendamentoId:'',
        agendouEm:'',
        retornouEm:''
      }));
      if (restored.error) throw new Error(restored.error);
      const event = registrarEventoRelacionamentoUnlocked_({
        idempotencyKey:'auto:desvinculo:' + appointmentId,
        oportunidadeId:priorOpportunity.id,
        clienteId:priorOpportunity.clienteId,
        tipo:'desvinculo_exclusao',
        etapaAnterior:priorOpportunity.etapa,
        etapaNova:previousStage,
        origemAlteracao:'automatica',
        observacoes:'Agendamento e lançamento vinculados foram excluídos.'
      });
      if (event.error) throw new Error(event.error);
    }
    if (generatedReturn) markRowDeletedUnlocked_('relacionamento', generatedReturn.id, timestamp);
    if (cash) markRowDeletedUnlocked_('caixa', cash.id, timestamp);
    if (appointment) markRowDeletedUnlocked_('agendamentos', appointment.id, timestamp);
    if (typeof cancelarLembretesAgendamentoUnlocked_ === 'function') {
      cancelarLembretesAgendamentoUnlocked_(appointmentId, 'origem_excluida');
    }
    if (cash && cash.data) invalidateCaixaCaches_(normDate(cash.data));
    return {
      deletedAppointmentId:appointmentId,
      deletedCashId:cash && cash.id || '',
      deletedReturnId:generatedReturn && generatedReturn.id || ''
    };
  } catch (error) {
    snapshots.forEach(function (snapshot) {
      restoreRowObjectUnlocked_(snapshot.sheet, snapshot.item);
    });
    throw error;
  }
}

function deleteAgendamentoVinculado_(id) {
  return withDocumentLock_(function () {
    return deleteAgendamentoVinculadoUnlocked_(id);
  });
}

function validarRecomendacaoRetorno_(appointment, recommendation) {
  appointment = appointment || {};
  if (typeof recommendation === 'undefined') {
    return { semRetorno:true, legacy:true };
  }
  recommendation = recommendation || {};
  if (recommendation.semRetorno === true) {
    return { semRetorno:true, legacy:false };
  }
  if (!recommendation.data) {
    return { error:'Informe o próximo retorno ou escolha “sem retorno recomendado”.' };
  }
  let dataAlvo;
  try {
    dataAlvo = toISO(recommendation.data);
  } catch (error) {
    return { error:error.message };
  }
  const dataAtendimento = normDate(appointment.data);
  if (dataAtendimento && dataAlvo < dataAtendimento) {
    return { error:'O retorno não pode ser anterior ao atendimento.' };
  }
  return {
    data:dataAlvo,
    motivo:cleanText_(recommendation.motivo || appointment.servicos, 1000),
    semRetorno:false,
    legacy:false
  };
}

function garantirOportunidadeRetornoUnlocked_(appointment, recommendation) {
  appointment = appointment || {};
  recommendation = recommendation || {};
  if (recommendation.semRetorno === true) return { skipped:true };
  if (!appointment.id || !appointment.clienteId || !recommendation.data) {
    return { error:'Dados insuficientes para criar o próximo retorno.' };
  }
  const reference = 'retorno:' + appointment.id;
  const existing = getCachedRows_('relacionamento').find(function (item) {
    return item.origem === 'retorno' && item.referenciaId === reference;
  });
  if (existing) return { id:existing.id, item:existing, duplicate:true };

  const saved = upsertByIdUnlocked_('relacionamento', {
    clienteId:appointment.clienteId,
    clienteNome:cleanText_(appointment.clienteNome, 120),
    origem:'retorno',
    referenciaId:reference,
    dataAlvo:recommendation.data,
    etapa:'pendente',
    observacoes:cleanText_(recommendation.motivo, 1000)
  });
  if (saved.error) return saved;
  const event = registrarEventoRelacionamentoUnlocked_({
    idempotencyKey:'auto:retorno:' + appointment.id,
    oportunidadeId:saved.id,
    clienteId:appointment.clienteId,
    tipo:'criacao',
    etapaAnterior:'',
    etapaNova:'pendente',
    origemAlteracao:'automatica',
    observacoes:'Retorno recomendado ao concluir o atendimento.'
  });
  if (event.error) {
    softDeleteUnlocked_('relacionamento', saved.id);
    return event;
  }
  return saved;
}

function vincularOportunidadeAoAgendamentoUnlocked_(appointment) {
  appointment = appointment || {};
  const storedAppointment = getCachedRows_('agendamentos').find(function (item) {
    return String(item.id) === String(appointment.id);
  });
  const currentAppointment = Object.assign({}, storedAppointment || {}, appointment);
  if (!currentAppointment.id || !currentAppointment.clienteId) return null;

  if (currentAppointment.oportunidadeId) {
    const linked = oportunidadeRelacionamentoPorId_(currentAppointment.oportunidadeId);
    if (linked && (linked.etapa === 'agendou' || linked.etapa === 'retornou')) {
      return { id:linked.id, item:linked, duplicate:true };
    }
  }

  const selected = selecionarOportunidadeParaAgendamento_(getCachedRows_('relacionamento'), {
    clienteId:currentAppointment.clienteId,
    oportunidadeId:currentAppointment.oportunidadeId,
    criadoEm:currentAppointment.criadoEm || nowIso()
  });
  if (!selected) return null;

  const appointmentSnapshot = Object.assign({}, currentAppointment);
  const linkedAppointment = upsertByIdUnlocked_('agendamentos', Object.assign(
    {}, currentAppointment, { oportunidadeId:selected.id }
  ));
  if (linkedAppointment.error) return linkedAppointment;
  const saved = atualizarEtapaRelacionamentoUnlocked_(selected, 'agendou', {
    idempotencyKey:'auto:agendou:' + currentAppointment.id,
    origemAlteracao:'automatica',
    tipo:'agendamento',
    patch:{ agendamentoId:currentAppointment.id }
  });
  if (saved.error) {
    upsertByIdUnlocked_('agendamentos', appointmentSnapshot);
    return saved;
  }
  return saved;
}

function marcarRetornoDoAgendamentoUnlocked_(appointment) {
  appointment = appointment || {};
  if (!appointment.oportunidadeId) return null;
  const item = oportunidadeRelacionamentoPorId_(appointment.oportunidadeId);
  if (!item) return null;
  if (item.etapa === 'retornou') return { id:item.id, item:item, duplicate:true };
  return atualizarEtapaRelacionamentoUnlocked_(item, 'retornou', {
    idempotencyKey:'auto:retornou:' + appointment.id,
    origemAlteracao:'automatica',
    tipo:'retorno'
  });
}

function encerrarPendentesPorAgendamentoEspontaneoUnlocked_(appointment) {
  appointment = appointment || {};
  let total = 0;
  getCachedRows_('relacionamento').filter(function (item) {
    return String(item.clienteId) === String(appointment.clienteId) &&
      item.etapa === 'pendente' &&
      !item.encerramentoMotivo &&
      String(item.criadoEm || '') <= String(appointment.criadoEm || nowIso()) &&
      String(item.dataAlvo || '') <= String(normDate(appointment.data) || '');
  }).forEach(function (item) {
    const snapshot = Object.assign({}, item);
    const saved = upsertByIdUnlocked_('relacionamento', Object.assign({}, item, {
      encerramentoMotivo:'retorno_espontaneo'
    }));
    if (saved.error) return;
    const event = registrarEventoRelacionamentoUnlocked_({
      idempotencyKey:'auto:espontaneo:' + appointment.id + ':' + item.id,
      oportunidadeId:item.id,
      clienteId:item.clienteId,
      tipo:'encerramento',
      etapaAnterior:'pendente',
      etapaNova:'pendente',
      origemAlteracao:'automatica',
      observacoes:'Cliente já possuía agendamento futuro antes do contato.'
    });
    if (event.error) {
      upsertByIdUnlocked_('relacionamento', snapshot);
      return;
    }
    total += 1;
  });
  return { total:total };
}

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
  try { CACHE.remove('caixa_dia_' + data); } catch (_) { /* cache é melhor esforço */ }
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
  d = d || {};
  return withDocumentLock_(function () {
    const previous = d.id
      ? getCachedRows_('caixa').find(item => String(item.id) === String(d.id)) || null
      : null;
    const linkedAppointmentId = agendamentoIdDoCaixa_(previous);
    const payload = Object.assign({}, d);
    if (linkedAppointmentId) {
      payload.itemId = 'agcash:' + linkedAppointmentId;
      payload.itemTipo = 'agendamento';
      payload.tipo = 'entrada';
      payload.isRetirada = false;
    }
    const saved = saveLancamentoUnlocked_(payload);
    if (saved.error || !linkedAppointmentId) return saved;
    const synchronized = sincronizarCaixaComAgendamentoUnlocked_(saved.item || payload);
    if (synchronized && synchronized.error) {
      if (previous) restoreRowObjectUnlocked_('caixa', previous);
      return synchronized;
    }
    saved.linkedAppointmentId = linkedAppointmentId;
    return saved;
  });
}

function deleteLancamento_(id) {
  return withDocumentLock_(function () {
    const cash = getRowObjectById_('caixa', id);
    if (!cash) return { error:'Lançamento não encontrado.' };
    const appointmentId = agendamentoIdDoCaixa_(cash);
    if (appointmentId) return deleteAgendamentoVinculadoUnlocked_(appointmentId);
    markRowDeletedUnlocked_('caixa', cash.id, nowIso());
    if (cash.data) invalidateCaixaCaches_(normDate(cash.data));
    return { deleted:cash.id };
  });
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
    const clienteId = cleanId_(d.clienteId);
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
      clienteId,
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
        clienteId,
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
        const entryItemId = 'fiadoentrada:' + idempotencyKey;
        const existingEntryCash = findCashByItemId_(entryItemId);
        if (existingEntryCash) {
          cashId = existingEntryCash.id;
        } else {
          const cashResult = saveLancamentoUnlocked_({
            tipo: 'entrada',
            clienteId: clienteId,
            clienteNome: clienteNome,
            itemId: entryItemId,
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
    const idempotencyKey = String(b.idempotencyKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
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
  const duration = parseInt(typeof d.duracaoMin === 'undefined' || d.duracaoMin === '' ? 60 : d.duracaoMin, 10);
  const status = d.status || 'agendado';
  const valueCents = paraCentavos_(d.valor || 0);
  if (!clienteNome) return { error: 'Selecione a cliente do agendamento.' };
  if (['agendado','concluido','cancelado'].indexOf(status) < 0) return { error: 'Status do agendamento inválido.' };
  if (!validTime_(d.hora || '09:00')) return { error: 'Horário do agendamento inválido.' };
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return { error: 'Duração do agendamento inválida.' };
  if (valueCents < 0) return { error: 'Valor do agendamento inválido.' };
  return upsertByIdUnlocked_('agendamentos', {
    id: d.id || '',
    data: toISO(d.data || today()),
    hora: d.hora || '09:00',
    duracaoMin: duration,
    clienteId: d.clienteId || '',
    clienteNome: clienteNome,
    colaboradorId: d.colaboradorId || '',
    colaboradorNome: cleanText_(d.colaboradorNome, 120),
    servicos: cleanText_(d.servicos, 1000),
    valor: deCentavos_(valueCents),
    status: status,
    observacoes: cleanText_(d.observacoes, 1000),
    retornoRecomendado: d.retornoRecomendado ? toISO(d.retornoRecomendado) : '',
    retornoMotivo: cleanText_(d.retornoMotivo, 1000),
    oportunidadeId: d.oportunidadeId || ''
  });
}

function saveAgendamento(d) {
  d = d || {};
  return withDocumentLock_(function () {
    const requestedStatus = d.status || 'agendado';
    const currentAppointment = d.id ? getRowObjectById_('agendamentos', d.id) : null;

    if (!d.id && requestedStatus === 'concluido') {
      return { error: 'Conclua o atendimento pela ação própria para registrar também a entrada no caixa.' };
    }

    if (d.id) {
      if (!currentAppointment || currentAppointment.deletadoEm) return { error:'Agendamento não encontrado.' };
      const currentStatus = String(currentAppointment.status || 'agendado');
      if (currentStatus !== 'concluido' && requestedStatus === 'concluido') {
        return { error: 'Conclua o atendimento pela ação própria para registrar também a entrada no caixa.' };
      }
      if (currentStatus === 'concluido' && requestedStatus !== 'concluido') {
        return { error: 'Um atendimento concluído não pode ter o status reaberto pela edição.' };
      }
    }

    const payload = Object.assign({}, currentAppointment || {}, d);
    const saved = saveAgendamentoUnlocked_(payload);
    if (saved.error) return saved;
    if (requestedStatus === 'concluido') {
      const synchronized = sincronizarAgendamentoComCaixaUnlocked_(saved.item || payload);
      if (synchronized && synchronized.error) {
        if (currentAppointment) restoreRowObjectUnlocked_('agendamentos', currentAppointment);
        return synchronized;
      }
      cancelarLembretesAgendamentoUnlocked_((saved.item || payload).id, 'agendamento_concluido');
      saved.linkedCashId = synchronized && synchronized.id || '';
      return saved;
    }
    if (requestedStatus !== 'agendado') {
      cancelarLembretesAgendamentoUnlocked_((saved.item || payload).id, 'agendamento_inativo');
      return saved;
    }

    let relationship = { ok:true };
    try {
      const linked = vincularOportunidadeAoAgendamentoUnlocked_(saved.item || payload);
      if (linked && linked.error) throw new Error(linked.error);
      const spontaneous = linked ? null : encerrarPendentesPorAgendamentoEspontaneoUnlocked_(saved.item || payload);
      relationship = {
        ok:true,
        opportunityId:linked && (linked.id || linked.item && linked.item.id) || '',
        spontaneousClosures:spontaneous ? spontaneous.total : 0
      };
    } catch (relationshipError) {
      relationship = {
        ok:false,
        warning:'Agendamento salvo; relacionamento pendente: ' + relationshipError.message
      };
    }
    saved.relationship = relationship;
    try {
      saved.reminder = garantirLembreteAgendamentoUnlocked_(saved.item || payload);
    } catch (reminderError) {
      saved.reminder = {
        ok:false,
        warning:'Agendamento salvo; lembrete pendente: ' + reminderError.message
      };
    }
    return saved;
  });
}

function concluirAgendamentoComCaixa_(b) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    b = b || {};
    const appointment = b.appointment || {};
    const cash = b.cash || {};
    const appointmentId = String(appointment.id || '');
    if (!appointmentId) return { error: 'Agendamento inválido.' };
    const returnRecommendation = validarRecomendacaoRetorno_(
      appointment,
      Object.prototype.hasOwnProperty.call(b, 'returnRecommendation') ? b.returnRecommendation : undefined
    );
    if (returnRecommendation.error) return returnRecommendation;
    const rowNum = rowNumForId_('agendamentos', appointmentId);
    if (!rowNum) return { error: 'Agendamento não encontrado.' };
    const sheet = getSheet('agendamentos');
    const snapshot = sheet.getRange(rowNum, 1, 1, SCHEMAS.agendamentos.length).getValues()[0];
    const currentAppointment = {};
    SCHEMAS.agendamentos.forEach(function (header, index) {
      currentAppointment[header] = snapshot[index];
    });
    const currentStatus = String(snapshot[SCHEMAS.agendamentos.indexOf('status')] || 'agendado');
    const cashItemId = 'agcash:' + appointmentId;
    const existingCash = findCashByItemId_(cashItemId);
    if (existingCash && currentStatus === 'concluido') {
      let relationship = { ok:true };
      try {
        const prior = marcarRetornoDoAgendamentoUnlocked_(currentAppointment);
        const next = garantirOportunidadeRetornoUnlocked_(currentAppointment, returnRecommendation);
        if (prior && prior.error) throw new Error(prior.error);
        if (next && next.error) throw new Error(next.error);
        relationship.priorOpportunityId = prior && (prior.id || prior.item && prior.item.id) || '';
        relationship.opportunityId = next && (next.id || next.item && next.item.id) || '';
      } catch (relationshipError) {
        relationship = {
          ok:false,
          warning:'Atendimento e caixa concluídos; relacionamento pendente: ' + relationshipError.message
        };
      }
      cancelarLembretesAgendamentoUnlocked_(appointmentId, 'agendamento_concluido');
      return { completed:true, duplicate:true, cashId:existingCash.id, relationship:relationship };
    }
    if (existingCash) {
      return { error: 'Já existe uma entrada no caixa para este atendimento, mas o status está inconsistente.' };
    }
    if (currentStatus !== 'agendado') {
      return { error: 'Somente um atendimento agendado pode ser concluído.' };
    }

    let savedAppointment;
    let savedCash;
    try {
      const appointmentToSave = Object.assign({}, currentAppointment, appointment, { status:'concluido' });
      if (!returnRecommendation.legacy) {
        appointmentToSave.retornoRecomendado = returnRecommendation.semRetorno ? '' : returnRecommendation.data;
        appointmentToSave.retornoMotivo = returnRecommendation.semRetorno ? '' : returnRecommendation.motivo;
      }
      savedAppointment = saveAgendamentoUnlocked_(appointmentToSave);
      if (savedAppointment.error) return savedAppointment;
      savedCash = saveLancamentoUnlocked_({
        ...cash,
        id: '',
        tipo: 'entrada',
        itemId: cashItemId,
        itemTipo: 'agendamento',
        data: toISO(cash.data || today())
      });
      if (savedCash.error) throw new Error(savedCash.error);
    } catch (writeError) {
      sheet.getRange(rowNum, 1, 1, snapshot.length).setValues([snapshot]);
      invalidateSheetCache_('agendamentos');
      throw writeError;
    }

    let relationship = { ok:true };
    try {
      const completedAppointment = savedAppointment.item || appointment;
      const prior = marcarRetornoDoAgendamentoUnlocked_(completedAppointment);
      const next = garantirOportunidadeRetornoUnlocked_(completedAppointment, returnRecommendation);
      if (prior && prior.error) throw new Error(prior.error);
      if (next && next.error) throw new Error(next.error);
      relationship.priorOpportunityId = prior && (prior.id || prior.item && prior.item.id) || '';
      relationship.opportunityId = next && (next.id || next.item && next.item.id) || '';
    } catch (relationshipError) {
      relationship = {
        ok:false,
        warning:'Atendimento e caixa concluídos; relacionamento pendente: ' + relationshipError.message
      };
    }
    cancelarLembretesAgendamentoUnlocked_(appointmentId, 'agendamento_concluido');
    return { completed:true, cashId:savedCash.id, relationship:relationship };
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
      s.getRange(rowNum, 10).setValue(cleanText_(b.observacoes, 1000));
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

// ── DRE gerencial ─────────────────────────────────────────────
function validarCategoriaDre_(value) {
  return DRE_CATEGORIAS_.indexOf(String(value || '')) >= 0;
}

function listarMapeamentosDre_() {
  return getCachedRows_('dre_mapeamento');
}

function getDreAnual_(params) {
  params = params || {};
  var year = parseInt(params.ano, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return { error:'Ano inválido.' };
  var dre = montarDreAnual_(getCachedRows_('caixa'), listarMapeamentosDre_(), year);
  delete dre.movimentosClassificados;
  return dre;
}

function getDreDetalhe_(params) {
  params = params || {};
  var year = parseInt(params.ano, 10);
  var hasMonth = params.mes !== null && params.mes !== '' && typeof params.mes !== 'undefined';
  var month = hasMonth ? parseInt(params.mes, 10) : null;
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return { error:'Ano inválido.' };
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return { error:'Mês inválido.' };
  var line = String(params.linha || '');
  var allowed = DRE_CATEGORIAS_.concat(['nao_classificado','receita_liquida','margem_contribuicao','resultado_liquido','resultado_apos_retiradas']);
  if (allowed.indexOf(line) < 0 || line === 'fora_dre') return { error:'Linha da DRE inválida.' };
  var dre = montarDreAnual_(getCachedRows_('caixa'), listarMapeamentosDre_(), year);
  return detalharCelulaDre_(dre.movimentosClassificados, line, month);
}

function salvarClassificacaoDre_(body) {
  body = body || {};
  return withDocumentLock_(function () {
    var id = cleanId_(body.id);
    var rowNum = rowNumForId_('caixa', id);
    if (!rowNum) return { error:'Lançamento não encontrado.' };
    if (!validarCategoriaDre_(body.dreCategoria)) return { error:'Categoria da DRE inválida.' };
    var sheet = getSheet('caixa');
    var headers = SCHEMAS.caixa;
    var current = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
    var deletedIndex = headers.indexOf('deletadoEm');
    if (deletedIndex >= 0 && current[deletedIndex]) return { error:'Lançamento excluído não pode ser classificado.' };
    sheet.getRange(rowNum, SCHEMAS.caixa.indexOf('dreCategoria') + 1).setValue(body.dreCategoria);
    sheet.getRange(rowNum, SCHEMAS.caixa.indexOf('atualizadoEm') + 1).setValue(nowIso());
    invalidateSheetCache_('caixa');
    return { id:id, dreCategoria:body.dreCategoria };
  });
}

function salvarMapeamentoDre_(body) {
  var data = body && body.data ? body.data : {};
  if (!validarCategoriaDre_(data.dreCategoria)) return { error:'Categoria da DRE inválida.' };
  var tipo = String(data.tipo || '');
  if (['entrada','saida',''].indexOf(tipo) < 0) return { error:'Tipo de movimento inválido.' };
  var categoriaCaixa = cleanText_(data.categoriaCaixa, 120);
  var itemTipo = cleanText_(data.itemTipo, 40);
  if (!tipo && !categoriaCaixa && !itemTipo) return { error:'Defina ao menos um critério para o padrão.' };
  return upsertById_('dre_mapeamento', {
    id:data.id || '',
    tipo:tipo,
    categoriaCaixa:categoriaCaixa,
    itemTipo:itemTipo,
    dreCategoria:data.dreCategoria,
    ativo:normalizeBoolStr(data.ativo, 'true')
  });
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
    case 'getRelacionamento':
      materializarAniversarios_(parseInt(today().slice(0, 4), 10));
      return ok(listarRelacionamento_(e.parameter));
    case 'getRelacionamentoResumo':
      materializarAniversarios_(parseInt(today().slice(0, 4), 10));
      return ok(calcularIndicadoresRelacionamento_(listarRelacionamento_(e.parameter)));
    case 'getRelacionamentoEventos': return ok(listarEventosRelacionamento_(e.parameter));
    case 'getCampanhas':        return ok(getCachedRows_('campanhas'));
    case 'getLembretesConfig':  return ok(getLembretesConfig_());
    case 'getLembretesEnvios':  return ok(listarLembretesEnvios_(e.parameter));
    case 'getClientesTelefonePendente': return ok(listarClientesTelefonePendente_());
    case 'getDreMapeamentos':   return ok(listarMapeamentosDre_());
    case 'getDreAnual':         return result(getDreAnual_(e.parameter));
    case 'getDreDetalhe':       return result(getDreDetalhe_(e.parameter));
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
      case 'deleteAgendamento':  return result(deleteAgendamentoVinculado_(b.id));
      case 'deleteLancamento':   return result(deleteLancamento_(b.id));
      case 'deleteCrediario':    return result(deleteCrediario(b.id));
      case 'confirmarContato':   return result(confirmarContato_(b));
      case 'saveRelacionamentoEtapa': return result(salvarEtapaRelacionamento_(b));
      case 'saveCampanha':       return result(salvarCampanha_(b));
      case 'generateCampanha':   return result(gerarOportunidadesCampanha_(b));
      case 'saveLembretesConfig': return result(salvarLembretesConfig_(b));
      case 'testWhatsAppConfig': return result(testarWhatsAppConfig_());
      case 'runLembretesNow':    return result(processarLembretesAutomaticos_());
      case 'saveDreClassificacao': return result(salvarClassificacaoDre_(b));
      case 'saveDreMapeamento':  return result(salvarMapeamentoDre_(b));
      default: return err('Ação desconhecida: ' + a);
    }
  } catch (e2) {
    return err('Erro interno: ' + e2.message);
  }
}
