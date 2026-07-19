const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'Código.gs'), 'utf8');
const relationshipRules = fs.readFileSync(path.join(root, 'RelacionamentoRegras.gs'), 'utf8');
const sharedRules = fs.readFileSync(path.join(root, 'Regras.gs'), 'utf8');

function relationshipFixture(seed = {}) {
  const stores = {
    clientes: structuredClone(seed.clientes || []),
    relacionamento: structuredClone(seed.relacionamento || []),
    relacionamento_eventos: structuredClone(seed.relacionamento_eventos || []),
    campanhas: structuredClone(seed.campanhas || []),
    agendamentos: structuredClone(seed.agendamentos || [])
  };
  const noopCache = { get:() => null, put() {}, remove() {} };
  const noopProperties = {
    getProperty:() => null, setProperty() {}, setProperties() {},
    deleteProperty() {}, getProperties:() => ({})
  };
  const lock = { waitLock() {}, releaseLock() {} };
  const context = vm.createContext({
    console,
    __stores:stores,
    __counter:0,
    CacheService:{ getScriptCache:() => noopCache },
    PropertiesService:{ getScriptProperties:() => noopProperties },
    SpreadsheetApp:{ getActiveSpreadsheet:() => ({}) },
    LockService:{ getDocumentLock:() => lock, getScriptLock:() => lock },
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
  vm.runInContext(sharedRules, context, { filename:'Regras.gs' });
  vm.runInContext(backend, context, { filename:'Código.gs' });
  vm.runInContext(`
    nowIso = function () { return '2026-07-19T12:00:00'; };
    today = function () { return '2026-07-19'; };
    withDocumentLock_ = function (fn) { return fn(); };
    getCachedRows_ = function (name) {
      return (__stores[name] || []).filter(function (item) { return !item.deletadoEm; });
    };
    upsertByIdUnlocked_ = function (name, record) {
      var list = __stores[name] || (__stores[name] = []);
      var id = record.id || name.slice(0, 3) + '_' + (++__counter);
      var index = list.findIndex(function (item) { return item.id === id; });
      var previous = index >= 0 ? list[index] : {};
      var item = Object.assign({}, previous, record, {
        id:id,
        criadoEm:previous.criadoEm || record.criadoEm || nowIso(),
        atualizadoEm:nowIso(),
        deletadoEm:record.deletadoEm || previous.deletadoEm || ''
      });
      if (index >= 0) list[index] = item;
      else list.push(item);
      return { id:id, item:item };
    };
  `, context);
  return {
    stores,
    call(expression) {
      return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
    }
  };
}

test('declara schemas de relacionamento e preserva extensões no fim', () => {
  for (const name of ['relacionamento','relacionamento_eventos','campanhas']) {
    assert.match(backend, new RegExp(name + ':\\s*\\['));
  }
  assert.match(backend, /clientes:\s*\[[\s\S]{0,250}'naoContatar'\s*\]/);
  assert.match(backend, /agendamentos:\s*\[[\s\S]{0,500}'retornoRecomendado','retornoMotivo','oportunidadeId'\s*\]/);
  assert.match(backend, /function ensureSheetSchema_\(/);
});

test('expõe contratos autenticados de leitura e escrita', () => {
  for (const action of [
    'getRelacionamento','getRelacionamentoResumo','getRelacionamentoEventos',
    'getCampanhas','confirmarContato','saveRelacionamentoEtapa'
  ]) {
    assert.match(backend, new RegExp("case '" + action + "':"));
  }
});

test('confirma contato com telefone atual, mensagem e evento auditável', () => {
  const fixture = relationshipFixture({
    clientes:[{ id:'cli_1', nome:'Ana', telefone:'(92) 99999-1111', naoContatar:'false' }],
    relacionamento:[{
      id:'rel_1', clienteId:'cli_1', clienteNome:'Ana', origem:'retorno',
      dataAlvo:'2026-07-01', etapa:'pendente', criadoEm:'2026-07-01T10:00:00'
    }]
  });
  const result = fixture.call("confirmarContato_({ id:'rel_1', mensagem:'Olá, Ana!', idempotencyKey:'contact_123456789012' })");
  assert.equal(result.item.etapa, 'contatada');
  assert.equal(result.item.telefoneContato, '5592999991111');
  assert.equal(result.item.mensagemContato, 'Olá, Ana!');
  assert.equal(result.item.recuperacaoAoContatar, 'true');
  assert.equal(fixture.stores.relacionamento_eventos.length, 1);
  assert.equal(fixture.stores.relacionamento_eventos[0].etapaNova, 'contatada');
});

test('repetir a mesma confirmação não duplica evento', () => {
  const fixture = relationshipFixture({
    clientes:[{ id:'cli_1', nome:'Ana', telefone:'92999991111', naoContatar:'false' }],
    relacionamento:[{ id:'rel_1', clienteId:'cli_1', dataAlvo:'2026-07-01', etapa:'pendente' }]
  });
  const expression = "confirmarContato_({ id:'rel_1', mensagem:'Mensagem', idempotencyKey:'contact_123456789012' })";
  fixture.call(expression);
  const repeated = fixture.call(expression);
  assert.equal(repeated.duplicate, true);
  assert.equal(fixture.stores.relacionamento_eventos.length, 1);
});

test('bloqueia contato sem telefone válido ou com opt-out', () => {
  const blocked = relationshipFixture({
    clientes:[{ id:'cli_1', telefone:'92999991111', naoContatar:'true' }],
    relacionamento:[{ id:'rel_1', clienteId:'cli_1', dataAlvo:'2026-07-20', etapa:'pendente' }]
  });
  assert.match(
    blocked.call("confirmarContato_({ id:'rel_1', mensagem:'Oi', idempotencyKey:'contact_123456789012' })").error,
    /não deseja receber/i
  );

  const invalid = relationshipFixture({
    clientes:[{ id:'cli_2', telefone:'123', naoContatar:'false' }],
    relacionamento:[{ id:'rel_2', clienteId:'cli_2', dataAlvo:'2026-07-20', etapa:'pendente' }]
  });
  assert.match(
    invalid.call("confirmarContato_({ id:'rel_2', mensagem:'Oi', idempotencyKey:'contact_123456789013' })").error,
    /telefone/i
  );
});

test('mudança manual registra histórico e pode corrigir etapa', () => {
  const fixture = relationshipFixture({
    clientes:[{ id:'cli_1', telefone:'92999991111', naoContatar:'false' }],
    relacionamento:[{
      id:'rel_1', clienteId:'cli_1', dataAlvo:'2026-07-20',
      etapa:'respondeu', contatadaEm:'2026-07-18T10:00:00', respondeuEm:'2026-07-18T11:00:00'
    }]
  });
  const result = fixture.call(
    "salvarEtapaRelacionamento_({ id:'rel_1', etapa:'contatada', observacoes:'Correção', idempotencyKey:'stage_123456789012' })"
  );
  assert.equal(result.item.etapa, 'contatada');
  assert.equal(fixture.stores.relacionamento_eventos[0].etapaAnterior, 'respondeu');
  assert.equal(fixture.stores.relacionamento_eventos[0].origemAlteracao, 'manual');
});

test('valida retorno antes de qualquer gravação', () => {
  const fixture = relationshipFixture();
  const missing = fixture.call(
    "validarRecomendacaoRetorno_({ data:'2026-07-19', servicos:'Corte' }, {})"
  );
  assert.match(missing.error, /próximo retorno/i);
  const before = fixture.call(
    "validarRecomendacaoRetorno_({ data:'2026-07-19', servicos:'Corte' }, { data:'2026-07-18' })"
  );
  assert.match(before.error, /anterior/i);
  assert.deepEqual(
    fixture.call("validarRecomendacaoRetorno_({ data:'2026-07-19', servicos:'Corte' }, { data:'2026-08-19', motivo:'' })"),
    { data:'2026-08-19', motivo:'Corte', semRetorno:false, legacy:false }
  );
  assert.deepEqual(
    fixture.call("validarRecomendacaoRetorno_({ data:'2026-07-19' }, { semRetorno:true })"),
    { semRetorno:true, legacy:false }
  );
});

test('cria uma única oportunidade para o retorno recomendado', () => {
  const fixture = relationshipFixture();
  const appointment = {
    id:'ag_1', clienteId:'cli_1', clienteNome:'Ana', data:'2026-07-19',
    servicos:'Corte', criadoEm:'2026-07-19T10:00:00'
  };
  const expression =
    "garantirOportunidadeRetornoUnlocked_(" + JSON.stringify(appointment) +
    ", { data:'2026-08-19', motivo:'Manutenção', semRetorno:false })";
  const first = fixture.call(expression);
  const repeated = fixture.call(expression);
  assert.equal(first.item.referenciaId, 'retorno:ag_1');
  assert.equal(repeated.duplicate, true);
  assert.equal(fixture.stores.relacionamento.length, 1);
  assert.equal(fixture.stores.relacionamento_eventos.length, 1);
});

test('vincula agendamento à oportunidade contatada e marca agendou', () => {
  const fixture = relationshipFixture({
    relacionamento:[{
      id:'rel_1', clienteId:'cli_1', origem:'retorno', dataAlvo:'2026-07-20',
      etapa:'respondeu', criadoEm:'2026-07-18T10:00:00'
    }],
    agendamentos:[{
      id:'ag_1', clienteId:'cli_1', data:'2026-07-25', etapa:'agendado',
      criadoEm:'2026-07-19T10:00:00'
    }]
  });
  const result = fixture.call(
    "vincularOportunidadeAoAgendamentoUnlocked_({ id:'ag_1', clienteId:'cli_1', data:'2026-07-25', criadoEm:'2026-07-19T10:00:00' })"
  );
  assert.equal(result.item.etapa, 'agendou');
  assert.equal(result.item.agendamentoId, 'ag_1');
  assert.equal(fixture.stores.agendamentos[0].oportunidadeId, 'rel_1');
});

test('conclusão do agendamento vinculado marca retornou', () => {
  const fixture = relationshipFixture({
    relacionamento:[{
      id:'rel_1', clienteId:'cli_1', origem:'retorno', dataAlvo:'2026-07-20',
      etapa:'agendou', agendamentoId:'ag_1'
    }]
  });
  const result = fixture.call(
    "marcarRetornoDoAgendamentoUnlocked_({ id:'ag_1', clienteId:'cli_1', oportunidadeId:'rel_1' })"
  );
  assert.equal(result.item.etapa, 'retornou');
  assert.equal(fixture.stores.relacionamento_eventos[0].tipo, 'retorno');
});

test('agendamento espontâneo encerra pendência sem conversão', () => {
  const fixture = relationshipFixture({
    relacionamento:[{
      id:'rel_1', clienteId:'cli_1', origem:'retorno', dataAlvo:'2026-07-20',
      etapa:'pendente', criadoEm:'2026-07-10T10:00:00'
    }]
  });
  const result = fixture.call(
    "encerrarPendentesPorAgendamentoEspontaneoUnlocked_({ id:'ag_1', clienteId:'cli_1', data:'2026-07-25', criadoEm:'2026-07-19T10:00:00' })"
  );
  assert.equal(result.total, 1);
  assert.equal(fixture.stores.relacionamento[0].encerramentoMotivo, 'retorno_espontaneo');
  assert.equal(fixture.stores.relacionamento_eventos[0].tipo, 'encerramento');
});

test('contrato de conclusão separa núcleo financeiro do CRM', () => {
  assert.match(backend, /function validarRecomendacaoRetorno_/);
  assert.match(backend, /returnRecommendation/);
  assert.match(backend, /relationship:\s*relationship/);
  assert.match(backend, /Atendimento e caixa concluídos/);
});

test('materializa uma oportunidade de aniversário por cliente e ano', () => {
  const fixture = relationshipFixture({
    clientes:[
      { id:'cli_1', nome:'Ana', telefone:'(92) 99999-1111', aniversario:'31/12/1990', naoContatar:'false' },
      { id:'cli_2', nome:'Bia', telefone:'92999992222', aniversario:'01/01/1991', naoContatar:'true' },
      { id:'cli_3', nome:'Cida', telefone:'123', aniversario:'02/01/1992', naoContatar:'false' }
    ]
  });
  const first = fixture.call('materializarAniversarios_(2026)');
  const repeated = fixture.call('materializarAniversarios_(2026)');
  assert.equal(first.total, 1);
  assert.equal(repeated.total, 0);
  assert.equal(fixture.stores.relacionamento.length, 1);
  assert.equal(fixture.stores.relacionamento[0].referenciaId, 'aniversario:cli_1:2026');
  assert.equal(fixture.stores.relacionamento[0].dataAlvo, '2026-12-31');
  assert.equal(fixture.stores.relacionamento_eventos.length, 1);
});

test('campanha cria público explícito elegível sem duplicar', () => {
  const fixture = relationshipFixture({
    clientes:[
      { id:'cli_1', nome:'Ana', telefone:'92999991111', naoContatar:'false' },
      { id:'cli_2', nome:'Bia', telefone:'92999992222', naoContatar:'true' },
      { id:'cli_3', nome:'Cida', telefone:'123', naoContatar:'false' },
      { id:'cli_4', nome:'Dora', telefone:'92999994444', naoContatar:'false' }
    ],
    campanhas:[{
      id:'cam_1', nome:'Julho', mensagemModelo:'Olá, {nome}!',
      dataInicio:'2026-07-01', dataFim:'2026-07-31', status:'ativa'
    }]
  });
  const expression =
    "gerarOportunidadesCampanha_({ campanhaId:'cam_1', clienteIds:['cli_1','cli_2','cli_3'] })";
  const first = fixture.call(expression);
  const repeated = fixture.call(expression);
  assert.equal(first.total, 1);
  assert.equal(first.ignoradas, 2);
  assert.equal(repeated.total, 0);
  assert.equal(fixture.stores.relacionamento.length, 1);
  assert.equal(fixture.stores.relacionamento[0].referenciaId, 'campanha:cam_1:cli_1');
  assert.equal(fixture.stores.relacionamento_eventos.length, 1);
});

test('salva campanha validada e expõe rotas autenticadas', () => {
  const fixture = relationshipFixture();
  const invalid = fixture.call("salvarCampanha_({ nome:'', mensagemModelo:'Oi', status:'ativa' })");
  assert.match(invalid.error, /nome/i);
  const saved = fixture.call(
    "salvarCampanha_({ nome:'Retorno julho', mensagemModelo:'Olá, {nome}!', dataInicio:'2026-07-01', dataFim:'2026-07-31', criterios:{ origem:'manual' }, status:'ativa' })"
  );
  assert.equal(saved.item.status, 'ativa');
  assert.equal(saved.item.criteriosJson, '{"origem":"manual"}');
  assert.match(backend, /case 'saveCampanha'/);
  assert.match(backend, /case 'generateCampanha'/);
});

test('lista enriquece fila, contato, mensagem e último atendimento', () => {
  const fixture = relationshipFixture({
    clientes:[
      { id:'cli_1', nome:'Ana', telefone:'(92) 99999-1111', naoContatar:'false' },
      { id:'cli_2', nome:'Bia', telefone:'92999992222', naoContatar:'true' },
      { id:'cli_3', nome:'Cida', telefone:'123', naoContatar:'false' }
    ],
    relacionamento:[
      { id:'rel_1', clienteId:'cli_1', clienteNome:'Ana', origem:'retorno', dataAlvo:'2026-07-20', etapa:'pendente', observacoes:'Corte' },
      { id:'rel_2', clienteId:'cli_2', clienteNome:'Bia', origem:'aniversario', dataAlvo:'2026-07-19', etapa:'pendente' },
      { id:'rel_3', clienteId:'cli_3', clienteNome:'Cida', origem:'campanha', campanhaId:'cam_1', dataAlvo:'2026-07-19', etapa:'pendente' }
    ],
    campanhas:[{ id:'cam_1', mensagemModelo:'Olá, {nome}! Temos uma novidade.' }],
    agendamentos:[
      { id:'ag_1', clienteId:'cli_1', data:'2026-06-10', servicos:'Escova', status:'concluido' },
      { id:'ag_2', clienteId:'cli_1', data:'2026-07-10', servicos:'Corte', status:'concluido' }
    ]
  });
  const list = fixture.call('listarRelacionamento_({})');
  const ana = list.find(item => item.id === 'rel_1');
  const bia = list.find(item => item.id === 'rel_2');
  const cida = list.find(item => item.id === 'rel_3');
  assert.equal(ana.fila, 'proximo');
  assert.equal(ana.telefoneWhatsApp, '5592999991111');
  assert.equal(ana.telefoneValido, true);
  assert.equal(ana.ultimoAtendimento, '2026-07-10');
  assert.equal(ana.ultimoServico, 'Corte');
  assert.match(ana.mensagemSugerida, /Ana/);
  assert.equal(bia.fila, 'inapto');
  assert.equal(bia.telefoneValido, false);
  assert.equal(cida.fila, 'inapto');
  assert.equal(cida.telefoneValido, false);
});
