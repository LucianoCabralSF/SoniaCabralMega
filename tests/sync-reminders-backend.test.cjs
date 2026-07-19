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
    ScriptApp:{ getProjectTriggers:() => [] },
    UrlFetchApp:{ fetch() { throw new Error('Envio externo não permitido neste fixture.'); } },
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
