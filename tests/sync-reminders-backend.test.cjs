const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'Código.gs'), 'utf8');
const relationshipRules = fs.readFileSync(path.join(root, 'RelacionamentoRegras.gs'), 'utf8');
const reminderRules = fs.readFileSync(path.join(root, 'LembreteRegras.gs'), 'utf8');
const sharedRules = fs.readFileSync(path.join(root, 'Regras.gs'), 'utf8');

function fixture(seed = {}) {
  const stores = {};
  for (const name of [
    'clientes','agendamentos','caixa','relacionamento','relacionamento_eventos',
    'campanhas','lembretes_envios','config'
  ]) stores[name] = structuredClone(seed[name] || []);

  const properties = structuredClone(seed.properties || {});
  const fetchCalls = [];
  const fetchResponses = structuredClone(seed.fetchResponses || []);
  const triggers = [];
  const noopCache = { get:() => null, put() {}, remove() {} };
  const noopLock = { waitLock() {}, releaseLock() {} };
  const context = vm.createContext({
    console,
    __stores:stores,
    __properties:properties,
    __counter:0,
    CacheService:{ getScriptCache:() => noopCache },
    PropertiesService:{
      getScriptProperties:() => ({
        getProperty:key => properties[key] || null,
        setProperty:(key, value) => { properties[key] = String(value); },
        setProperties:values => Object.assign(properties, values),
        deleteProperty:key => { delete properties[key]; },
        getProperties:() => structuredClone(properties)
      })
    },
    SpreadsheetApp:{ getActiveSpreadsheet:() => ({}) },
    LockService:{ getDocumentLock:() => noopLock, getScriptLock:() => noopLock },
    ScriptApp:{
      getProjectTriggers:() => triggers,
      deleteTrigger:trigger => {
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      newTrigger:handler => {
        const draft = { handler, minutes:0 };
        const builder = {
          timeBased() { return builder; },
          everyMinutes(minutes) { draft.minutes = minutes; return builder; },
          create() {
            const trigger = {
              handler:draft.handler,
              minutes:draft.minutes,
              getHandlerFunction() { return this.handler; }
            };
            triggers.push(trigger);
            return trigger;
          }
        };
        return builder;
      }
    },
    UrlFetchApp:{
      fetch(url, options) {
        fetchCalls.push({ url:String(url), options:structuredClone(options || {}) });
        const response = fetchResponses.shift() || { code:200, body:{ messages:[{ id:'wamid.fixture' }] } };
        if (response.throw) throw new Error(response.throw);
        return {
          getResponseCode:() => response.code,
          getContentText:() => typeof response.body === 'string' ? response.body : JSON.stringify(response.body || {})
        };
      }
    },
    Session:{ getScriptTimeZone:() => 'America/Manaus' },
    Utilities:{
      DigestAlgorithm:{ SHA_256:'SHA_256' },
      Charset:{ UTF_8:'UTF_8' },
      computeDigest:() => [],
      getUuid:() => 'fixture-uuid',
      formatDate:(_date, _tz, pattern) => pattern === 'yyyy-MM-dd' ? '2026-07-19' : '2026-07-19T12:00:00',
      sleep() {}
    },
    ContentService:{
      MimeType:{ JSON:'JSON' },
      createTextOutput:value => ({ value:String(value), setMimeType() { return this; } })
    }
  });

  vm.runInContext(relationshipRules, context, { filename:'RelacionamentoRegras.gs' });
  vm.runInContext(reminderRules, context, { filename:'LembreteRegras.gs' });
  vm.runInContext(sharedRules, context, { filename:'Regras.gs' });
  vm.runInContext(backend, context, { filename:'Código.gs' });
  vm.runInContext(`
    nowIso = function () { return '2026-07-19T12:00:00'; };
    today = function () { return '2026-07-19'; };
    withDocumentLock_ = function (fn) { return fn(); };
    invalidateSheetCache_ = function () {};
    invalidateCaixaCaches_ = function () {};
    getConfigObj = function () {
      var out = {};
      (__stores.config || []).forEach(function (item) { out[item.chave] = item.valor; });
      return out;
    };
    updateConfigValues_ = function (values) {
      Object.keys(values || {}).forEach(function (key) {
        var row = (__stores.config || []).find(function (item) { return item.chave === key; });
        if (row) row.valor = values[key];
        else (__stores.config || (__stores.config = [])).push({ chave:key, valor:values[key] });
      });
      return { updated:true };
    };
    getCachedRows_ = function (name) {
      return (__stores[name] || []).filter(function (item) { return !item.deletadoEm; });
    };
    getRowObjectById_ = function (name, id) {
      return (__stores[name] || []).find(function (item) { return String(item.id) === String(id); }) || null;
    };
    upsertByIdUnlocked_ = function (name, record) {
      var list = __stores[name] || (__stores[name] = []);
      var id = record.id || name.slice(0, 3) + '_' + (++__counter);
      var index = list.findIndex(function (item) { return String(item.id) === String(id); });
      var previous = index >= 0 ? list[index] : {};
      var item = Object.assign({}, previous, record, {
        id:id,
        criadoEm:previous.criadoEm || record.criadoEm || nowIso(),
        atualizadoEm:nowIso()
      });
      if (index >= 0) list[index] = item;
      else list.push(item);
      return { id:id, item:item };
    };
    markRowDeletedUnlocked_ = function (name, id, timestamp) {
      var item = getRowObjectById_(name, id);
      if (!item) return;
      item.deletadoEm = item.deletadoEm || timestamp || nowIso();
      item.atualizadoEm = timestamp || nowIso();
    };
    saveLancamentoUnlocked_ = function (record) {
      return upsertByIdUnlocked_('caixa', record);
    };
    saveAgendamentoUnlocked_ = function (record) {
      return upsertByIdUnlocked_('agendamentos', record);
    };
  `, context);

  return {
    stores,
    properties,
    fetchCalls,
    triggers,
    call(expression) {
      return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
    },
    row(name, id) {
      return stores[name].find(item => String(item.id) === String(id));
    },
    deleted(name, id) {
      return !!this.row(name, id)?.deletadoEm;
    }
  };
}

test('excluir caixa da agenda arquiva agenda, caixa e retorno futuro', () => {
  const f = fixture({
    agendamentos:[{
      id:'ag_1', data:'2026-07-19', hora:'10:00', status:'concluido',
      oportunidadeId:'rel_anterior', clienteId:'cli_1', clienteNome:'Ana'
    }],
    caixa:[{
      id:'cx_1', itemId:'agcash:ag_1', itemTipo:'agendamento', data:'2026-07-19',
      tipo:'entrada', clienteId:'cli_1', clienteNome:'Ana', itemNome:'Corte', valor:100
    }],
    relacionamento:[
      { id:'rel_novo', referenciaId:'retorno:ag_1', origem:'retorno', etapa:'pendente' },
      { id:'rel_anterior', clienteId:'cli_1', agendamentoId:'ag_1', etapa:'retornou', agendouEm:'x', retornouEm:'y' }
    ],
    relacionamento_eventos:[{
      id:'evt_1', idempotencyKey:'auto:agendou:ag_1', oportunidadeId:'rel_anterior',
      etapaAnterior:'respondeu', etapaNova:'agendou'
    }]
  });

  const result = f.call("deleteLancamento_('cx_1')");
  assert.equal(result.deletedAppointmentId, 'ag_1');
  assert.ok(f.deleted('agendamentos', 'ag_1'));
  assert.ok(f.deleted('caixa', 'cx_1'));
  assert.ok(f.deleted('relacionamento', 'rel_novo'));
  assert.equal(f.row('relacionamento', 'rel_anterior').agendamentoId, '');
  assert.equal(f.row('relacionamento', 'rel_anterior').etapa, 'respondeu');
  assert.equal(f.row('relacionamento', 'rel_anterior').retornouEm, '');
});

test('excluir pela agenda produz a mesma cascata e pode ser repetido', () => {
  const f = fixture({
    agendamentos:[{ id:'ag_1', status:'concluido', clienteId:'cli_1' }],
    caixa:[{ id:'cx_1', itemId:'agcash:ag_1', itemTipo:'agendamento' }],
    relacionamento:[{ id:'rel_novo', referenciaId:'retorno:ag_1', origem:'retorno', etapa:'pendente' }]
  });
  const first = f.call("deleteAgendamentoVinculado_('ag_1')");
  const repeated = f.call("deleteAgendamentoVinculado_('ag_1')");
  assert.equal(first.deletedAppointmentId, 'ag_1');
  assert.equal(repeated.deletedAppointmentId, 'ag_1');
  assert.ok(f.deleted('agendamentos', 'ag_1'));
  assert.ok(f.deleted('caixa', 'cx_1'));
  assert.ok(f.deleted('relacionamento', 'rel_novo'));
});

test('retorno cuja agenda de origem foi excluída aparece encerrado', () => {
  const f = fixture({
    clientes:[{ id:'cli_1', nome:'Ana', telefone:'92999991111', naoContatar:'false' }],
    relacionamento:[{
      id:'rel_1', clienteId:'cli_1', clienteNome:'Ana', referenciaId:'retorno:ag_excluido',
      origem:'retorno', etapa:'pendente', dataAlvo:'2026-07-20'
    }]
  });
  const [item] = f.call('listarRelacionamento_({})');
  assert.equal(item.fila, 'encerrado');
  assert.equal(item.encerramentoMotivo, 'origem_excluida');
});

test('edição do caixa preserva vínculo e sincroniza somente campos compartilhados', () => {
  const f = fixture({
    agendamentos:[{
      id:'ag_1', data:'2026-07-19', hora:'10:00', status:'concluido',
      clienteId:'cli_1', clienteNome:'Ana', servicos:'Corte', valor:100
    }],
    caixa:[{
      id:'cx_1', itemId:'agcash:ag_1', itemTipo:'agendamento', data:'2026-07-19',
      tipo:'entrada', clienteId:'cli_1', clienteNome:'Ana', itemNome:'Corte', valor:100
    }]
  });
  const result = f.call(`saveLancamento({
    id:'cx_1', itemId:'svc_9', itemTipo:'servico', clienteId:'cli_2', clienteNome:'Bia',
    itemNome:'Escova', valor:180, data:'2026-07-20', tipo:'entrada', formaPagamento:'pix'
  })`);
  assert.equal(result.item.itemId, 'agcash:ag_1');
  assert.equal(result.item.itemTipo, 'agendamento');
  assert.equal(f.row('agendamentos','ag_1').clienteId, 'cli_2');
  assert.equal(f.row('agendamentos','ag_1').servicos, 'Escova');
  assert.equal(f.row('agendamentos','ag_1').valor, 180);
  assert.equal(f.row('agendamentos','ag_1').data, '2026-07-19');
});

test('edição da agenda concluída atualiza caixa sem alterar data financeira', () => {
  const f = fixture({
    agendamentos:[{
      id:'ag_1', data:'2026-07-19', hora:'10:00', duracaoMin:60, status:'concluido',
      clienteId:'cli_1', clienteNome:'Ana', servicos:'Corte', valor:100
    }],
    caixa:[{
      id:'cx_1', itemId:'agcash:ag_1', itemTipo:'agendamento', data:'2026-07-20',
      tipo:'entrada', clienteId:'cli_1', clienteNome:'Ana', itemNome:'Corte', valor:100
    }]
  });
  f.call(`saveAgendamento({
    id:'ag_1', data:'2026-07-21', hora:'11:00', duracaoMin:60, status:'concluido',
    clienteId:'cli_2', clienteNome:'Bia', servicos:'Escova', valor:180
  })`);
  assert.equal(f.row('caixa','cx_1').clienteId, 'cli_2');
  assert.equal(f.row('caixa','cx_1').itemNome, 'Escova');
  assert.equal(f.row('caixa','cx_1').valor, 180);
  assert.equal(f.row('caixa','cx_1').data, '2026-07-20');
});

test('rotas de exclusão delegam ao serviço vinculado', () => {
  assert.match(backend, /case 'deleteAgendamento':\s+return result\(deleteAgendamentoVinculado_\(b\.id\)\)/);
  assert.match(backend, /function deleteLancamento_\(id\)[\s\S]{0,1200}deleteAgendamentoVinculadoUnlocked_/);
});

test('schema e rotas de lembretes são autenticados', () => {
  assert.match(backend, /const SHEETS_SCHEMA_VERSION = '5'/);
  assert.match(backend, /lembretes_envios:\s*\[[\s\S]{0,600}'deletadoEm'\s*\]/);
  for (const action of [
    'getLembretesConfig','getLembretesEnvios','getClientesTelefonePendente',
    'saveLembretesConfig','testWhatsAppConfig','runLembretesNow'
  ]) assert.match(backend, new RegExp("case '" + action + "':"));
});

test('configuração nunca devolve o token de acesso', () => {
  const f = fixture({
    properties:{ whatsapp_access_token:'segredo-super-secreto' },
    config:[
      { chave:'lembreteAutomaticoAtivo', valor:'false' },
      { chave:'lembreteAntecedenciaHoras', valor:'4' },
      { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
      { chave:'whatsappTemplateLanguage', valor:'pt_BR' },
      { chave:'whatsappApiVersion', valor:'v23.0' },
      { chave:'whatsappPhoneNumberId', valor:'123456789' }
    ]
  });
  const config = f.call('getLembretesConfig_()');
  assert.equal(config.tokenConfigurado, true);
  assert.equal(JSON.stringify(config).includes('segredo-super-secreto'), false);
});

test('reconciliação cria um único lembrete e reagendamento cancela a chave antiga', () => {
  const f = fixture({
    properties:{ whatsapp_access_token:'token' },
    config:[
      { chave:'salonName', valor:'Sonia Cabral' },
      { chave:'horaInicio', valor:'08:00' },
      { chave:'lembreteAutomaticoAtivo', valor:'true' },
      { chave:'lembreteAntecedenciaHoras', valor:'4' },
      { chave:'lembreteMensagemModelo', valor:'Olá, {nome}! {servico} às {hora}.' },
      { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
      { chave:'whatsappTemplateLanguage', valor:'pt_BR' },
      { chave:'whatsappApiVersion', valor:'v23.0' },
      { chave:'whatsappPhoneNumberId', valor:'123456789' }
    ],
    clientes:[{ id:'cli_1', nome:'Ana', telefone:'+55 55 92 99999-1111', naoContatar:'false' }]
  });
  const first = f.call(`garantirLembreteAgendamentoUnlocked_({
    id:'ag_1', clienteId:'cli_1', clienteNome:'Ana', servicos:'Escova',
    data:'2026-07-20', hora:'14:00', status:'agendado'
  })`);
  const duplicate = f.call(`garantirLembreteAgendamentoUnlocked_({
    id:'ag_1', clienteId:'cli_1', clienteNome:'Ana', servicos:'Escova',
    data:'2026-07-20', hora:'14:00', status:'agendado'
  })`);
  const changed = f.call(`garantirLembreteAgendamentoUnlocked_({
    id:'ag_1', clienteId:'cli_1', clienteNome:'Ana', servicos:'Escova',
    data:'2026-07-20', hora:'15:00', status:'agendado'
  })`);
  assert.equal(first.item.programadoPara, '2026-07-20T10:00:00');
  assert.equal(duplicate.duplicate, true);
  assert.notEqual(changed.item.idempotencyKey, first.item.idempotencyKey);
  assert.equal(f.stores.lembretes_envios.length, 2);
  assert.equal(f.stores.lembretes_envios[0].status, 'cancelado');
  assert.equal(changed.item.telefone, '5592999991111');
});

test('cliente bloqueada ou inválida não entra na fila', () => {
  const baseConfig = [
    { chave:'horaInicio', valor:'08:00' },
    { chave:'lembreteAutomaticoAtivo', valor:'true' },
    { chave:'lembreteAntecedenciaHoras', valor:'4' },
    { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
    { chave:'whatsappTemplateLanguage', valor:'pt_BR' },
    { chave:'whatsappApiVersion', valor:'v23.0' },
    { chave:'whatsappPhoneNumberId', valor:'123456789' }
  ];
  const f = fixture({
    properties:{ whatsapp_access_token:'token' },
    config:baseConfig,
    clientes:[
      { id:'cli_1', telefone:'92999991111', naoContatar:'true' },
      { id:'cli_2', telefone:'123', naoContatar:'false' }
    ]
  });
  for (const id of ['cli_1','cli_2']) {
    const result = f.call(`garantirLembreteAgendamentoUnlocked_({
      id:'ag_${id}', clienteId:'${id}', data:'2026-07-20', hora:'14:00', status:'agendado'
    })`);
    assert.equal(result.skipped, true);
  }
  assert.equal(f.stores.lembretes_envios.length, 0);
});

test('exclusão vinculada cancela lembrete pendente', () => {
  const f = fixture({
    agendamentos:[{ id:'ag_1', status:'agendado' }],
    lembretes_envios:[{
      id:'lem_1', idempotencyKey:'lembrete:ag_1:2026-07-20:14:00',
      agendamentoId:'ag_1', status:'pendente'
    }]
  });
  f.call("deleteAgendamentoVinculado_('ag_1')");
  assert.equal(f.row('lembretes_envios','lem_1').status, 'cancelado');
  assert.equal(f.row('lembretes_envios','lem_1').ultimoErro, 'origem_excluida');
});

test('processador envia template Meta devido uma única vez', () => {
  const f = fixture({
    properties:{ whatsapp_access_token:'token-secreto' },
    config:[
      { chave:'salonName', valor:'Sonia Cabral' },
      { chave:'horaInicio', valor:'08:00' },
      { chave:'lembreteAutomaticoAtivo', valor:'true' },
      { chave:'lembreteAntecedenciaHoras', valor:'4' },
      { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
      { chave:'whatsappTemplateLanguage', valor:'pt_BR' },
      { chave:'whatsappApiVersion', valor:'v23.0' },
      { chave:'whatsappPhoneNumberId', valor:'123456789' }
    ],
    clientes:[{ id:'cli_1', nome:'Ana', telefone:'92999991111', naoContatar:'false' }],
    agendamentos:[{
      id:'ag_1', clienteId:'cli_1', clienteNome:'Ana', servicos:'Escova',
      data:'2026-07-19', hora:'14:00', status:'agendado'
    }],
    lembretes_envios:[{
      id:'lem_1', idempotencyKey:'lembrete:ag_1:2026-07-19:14:00',
      agendamentoId:'ag_1', clienteId:'cli_1', agendamentoData:'2026-07-19',
      agendamentoHora:'14:00', programadoPara:'2026-07-19T10:00:00',
      telefone:'5592999991111', status:'pendente', tentativas:0
    }],
    fetchResponses:[{ code:200, body:{ messages:[{ id:'wamid.123' }] } }]
  });
  const first = f.call("processarLembretesAutomaticos_('2026-07-19T10:01:00')");
  const second = f.call("processarLembretesAutomaticos_('2026-07-19T10:02:00')");
  assert.equal(first.enviados, 1);
  assert.equal(second.enviados, 0);
  assert.equal(f.fetchCalls.length, 1);
  assert.equal(f.row('lembretes_envios','lem_1').status, 'enviado');
  assert.equal(f.row('lembretes_envios','lem_1').providerMessageId, 'wamid.123');
  const payload = JSON.parse(f.fetchCalls[0].options.payload);
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'lembrete_agendamento');
  assert.deepEqual(payload.template.components[0].parameters.map(item => item.text),
    ['Ana','Escova','Sonia Cabral','19/07/2026','14:00']);
});

test('falha da Meta é auditada sem expor o token', () => {
  const f = fixture({
    properties:{ whatsapp_access_token:'token-secreto' },
    config:[
      { chave:'lembreteAutomaticoAtivo', valor:'true' },
      { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
      { chave:'whatsappTemplateLanguage', valor:'pt_BR' },
      { chave:'whatsappApiVersion', valor:'v23.0' },
      { chave:'whatsappPhoneNumberId', valor:'123456789' }
    ],
    agendamentos:[{ id:'ag_1', data:'2026-07-19', hora:'14:00', status:'agendado' }],
    lembretes_envios:[{
      id:'lem_1', agendamentoId:'ag_1', agendamentoData:'2026-07-19',
      agendamentoHora:'14:00', programadoPara:'2026-07-19T10:00:00',
      telefone:'5592999991111', status:'pendente', tentativas:0
    }],
    fetchResponses:[{ code:400, body:{ error:{ message:'token-secreto expirou' } } }]
  });
  const result = f.call("processarLembretesAutomaticos_('2026-07-19T10:01:00')");
  const reminder = f.row('lembretes_envios','lem_1');
  assert.equal(result.erros, 1);
  assert.equal(reminder.status, 'erro');
  assert.equal(reminder.tentativas, 1);
  assert.equal(reminder.ultimoErro.includes('token-secreto'), false);
});

test('lembrete vencido nunca é enviado depois do atendimento', () => {
  const f = fixture({
    properties:{ whatsapp_access_token:'token' },
    config:[
      { chave:'lembreteAutomaticoAtivo', valor:'true' },
      { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
      { chave:'whatsappPhoneNumberId', valor:'123456789' }
    ],
    agendamentos:[{ id:'ag_1', data:'2026-07-19', hora:'10:00', status:'agendado' }],
    lembretes_envios:[{
      id:'lem_1', agendamentoId:'ag_1', agendamentoData:'2026-07-19',
      agendamentoHora:'10:00', programadoPara:'2026-07-19T08:00:00',
      telefone:'5592999991111', status:'pendente', tentativas:0
    }]
  });
  const result = f.call("processarLembretesAutomaticos_('2026-07-19T10:00:00')");
  assert.equal(result.expirados, 1);
  assert.equal(f.fetchCalls.length, 0);
  assert.equal(f.row('lembretes_envios','lem_1').status, 'expirado');
});

test('agendador mantém apenas um gatilho de quinze minutos', () => {
  const f = fixture();
  f.call('configurarTriggerLembretes_(true)');
  f.call('configurarTriggerLembretes_(true)');
  assert.equal(f.triggers.length, 1);
  assert.equal(f.triggers[0].handler, 'processarLembretesAutomaticos_');
  assert.equal(f.triggers[0].minutes, 15);
  f.call('configurarTriggerLembretes_(false)');
  assert.equal(f.triggers.length, 0);
});

test('teste de credenciais consulta o número sem enviar mensagem', () => {
  const f = fixture({
    properties:{ whatsapp_access_token:'token' },
    config:[
      { chave:'whatsappTemplateName', valor:'lembrete_agendamento' },
      { chave:'whatsappApiVersion', valor:'v23.0' },
      { chave:'whatsappPhoneNumberId', valor:'123456789' }
    ],
    fetchResponses:[{ code:200, body:{ id:'123456789', display_phone_number:'+55 92 99999-0000' } }]
  });
  const result = f.call('testarWhatsAppConfig_()');
  assert.equal(result.ok, true);
  assert.equal(f.fetchCalls.length, 1);
  assert.equal(String(f.fetchCalls[0].options.method).toLowerCase(), 'get');
  assert.equal(f.fetchCalls[0].url.endsWith('/messages'), false);
});
