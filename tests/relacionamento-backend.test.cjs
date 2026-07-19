const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'Código.gs'), 'utf8');
const relationshipRules = fs.readFileSync(path.join(root, 'RelacionamentoRegras.gs'), 'utf8');

function relationshipFixture(seed = {}) {
  const stores = {
    clientes: structuredClone(seed.clientes || []),
    relacionamento: structuredClone(seed.relacionamento || []),
    relacionamento_eventos: structuredClone(seed.relacionamento_eventos || []),
    campanhas: structuredClone(seed.campanhas || [])
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
