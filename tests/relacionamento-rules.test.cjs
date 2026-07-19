const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'RelacionamentoRegras.gs'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'RelacionamentoRegras.gs' });

test('normaliza telefone brasileiro para WhatsApp', () => {
  assert.equal(context.normalizarTelefoneWhatsApp_('(92) 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('55 92 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('123'), '');
});

test('separa retorno próximo, recuperação, futuro e encerrado', () => {
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-07-25', etapa:'pendente' }, '2026-07-19'), 'proximo');
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-07-01', etapa:'pendente' }, '2026-07-16'), 'recuperacao');
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-08-20', etapa:'pendente' }, '2026-07-19'), 'futuro');
  assert.equal(context.filaRelacionamento_({ dataAlvo:'2026-07-19', etapa:'retornou' }, '2026-07-19'), 'encerrado');
});

test('vínculo exige contato anterior e prioriza retorno', () => {
  const selected = context.selecionarOportunidadeParaAgendamento_([
    { id:'camp_1', clienteId:'cli_1', origem:'campanha', etapa:'contatada', dataAlvo:'2026-07-10', criadoEm:'2026-07-11T10:00:00' },
    { id:'ret_1', clienteId:'cli_1', origem:'retorno', etapa:'respondeu', dataAlvo:'2026-07-15', criadoEm:'2026-07-12T10:00:00' },
    { id:'pending_1', clienteId:'cli_1', origem:'retorno', etapa:'pendente', dataAlvo:'2026-07-14', criadoEm:'2026-07-10T10:00:00' }
  ], { clienteId:'cli_1', criadoEm:'2026-07-19T10:00:00' });
  assert.equal(selected.id, 'ret_1');
});

test('vínculo explícito vence a prioridade automática', () => {
  const selected = context.selecionarOportunidadeParaAgendamento_([
    { id:'camp_1', clienteId:'cli_1', origem:'campanha', etapa:'contatada', dataAlvo:'2026-07-10', criadoEm:'2026-07-11T10:00:00' },
    { id:'ret_1', clienteId:'cli_1', origem:'retorno', etapa:'respondeu', dataAlvo:'2026-07-15', criadoEm:'2026-07-12T10:00:00' }
  ], { clienteId:'cli_1', oportunidadeId:'camp_1', criadoEm:'2026-07-19T10:00:00' });
  assert.equal(selected.id, 'camp_1');
});

test('métricas vazias nunca retornam NaN', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.calcularIndicadoresRelacionamento_([]))),
    {
      elegiveis:0, contatadas:0, responderam:0, agendaram:0, retornaram:0, recuperadas:0,
      taxaContato:0, taxaResposta:0, taxaAgendamento:0, taxaRetorno:0,
      mediaHorasContatoAgendamento:0, mediaHorasAgendamentoRetorno:0
    }
  );
});

test('métricas calculam conversão e tempos médios', () => {
  const metrics = context.calcularIndicadoresRelacionamento_([
    {
      etapa:'retornou', recuperacaoAoContatar:'true',
      contatadaEm:'2026-07-01T10:00:00', agendouEm:'2026-07-01T12:00:00',
      retornouEm:'2026-07-02T12:00:00'
    },
    { etapa:'contatada', contatadaEm:'2026-07-03T10:00:00' },
    { etapa:'pendente', encerramentoMotivo:'retorno_espontaneo' }
  ]);
  assert.equal(metrics.elegiveis, 2);
  assert.equal(metrics.taxaContato, 1);
  assert.equal(metrics.taxaResposta, 0.5);
  assert.equal(metrics.taxaAgendamento, 1);
  assert.equal(metrics.taxaRetorno, 1);
  assert.equal(metrics.recuperadas, 1);
  assert.equal(metrics.mediaHorasContatoAgendamento, 2);
  assert.equal(metrics.mediaHorasAgendamentoRetorno, 24);
});
