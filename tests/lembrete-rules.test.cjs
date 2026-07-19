const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const relationshipSource = fs.readFileSync(path.join(root, 'RelacionamentoRegras.gs'), 'utf8');
const reminderPath = path.join(root, 'LembreteRegras.gs');
const reminderSource = fs.existsSync(reminderPath) ? fs.readFileSync(reminderPath, 'utf8') : '';
const context = {};
vm.createContext(context);
vm.runInContext(`${relationshipSource}\n${reminderSource}`, context, { filename:'lembrete-rules.bundle.gs' });

test('corrige 55 duplicado sem alterar número brasileiro válido', () => {
  assert.equal(context.normalizarTelefoneWhatsApp_('+55 55 92 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('+55 92 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('(92) 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('0055 92 99999-1111'), '5592999991111');
  assert.equal(context.normalizarTelefoneWhatsApp_('123'), '');
});

test('programa entre antecedência e abertura do salão', () => {
  assert.equal(context.calcularProgramacaoLembrete_(
    { id:'ag1', data:'2026-07-20', hora:'09:00', status:'agendado' },
    { horaInicio:'08:00', antecedenciaHoras:4 }
  ), '2026-07-20T08:00:00');
  assert.equal(context.calcularProgramacaoLembrete_(
    { id:'ag2', data:'2026-07-20', hora:'14:00', status:'agendado' },
    { horaInicio:'08:00', antecedenciaHoras:4 }
  ), '2026-07-20T10:00:00');
});

test('não agenda quando a abertura não antecede o atendimento', () => {
  assert.equal(context.calcularProgramacaoLembrete_(
    { id:'ag1', data:'2026-07-20', hora:'08:00', status:'agendado' },
    { horaInicio:'08:00', antecedenciaHoras:4 }
  ), '');
  assert.equal(context.calcularProgramacaoLembrete_(
    { id:'ag2', data:'2026-07-20', hora:'10:00', status:'cancelado' },
    { horaInicio:'08:00', antecedenciaHoras:3 }
  ), '');
});

test('gera chave diferente ao reagendar data ou hora', () => {
  const first = context.chaveLembreteAgendamento_({ id:'ag_1', data:'2026-07-20', hora:'10:00' });
  const changed = context.chaveLembreteAgendamento_({ id:'ag_1', data:'2026-07-20', hora:'11:00' });
  assert.equal(first, 'lembrete:ag_1:2026-07-20:10:00');
  assert.notEqual(first, changed);
});

test('renderiza somente variáveis permitidas e limita tamanho', () => {
  const result = context.renderizarMensagemLembrete_(
    'Olá, {nome}! {servico} em {data} às {hora}, na {salao}. {desconhecida}',
    { nome:'Ana', servico:'Escova', data:'20/07/2026', hora:'14:00', salao:'Sonia Cabral' }
  );
  assert.equal(result, 'Olá, Ana! Escova em 20/07/2026 às 14:00, na Sonia Cabral. {desconhecida}');
  assert.equal(context.renderizarMensagemLembrete_('x'.repeat(2500), {}).length, 2000);
});
