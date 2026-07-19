// Regras puras de lembretes. Não depende de SpreadsheetApp ou serviços externos.

function lembreteMinutos_(hora) {
  var match = String(hora || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  var hours = Number(match[1]);
  var minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

function lembreteHora_(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
    String(minutes % 60).padStart(2, '0');
}

function calcularProgramacaoLembrete_(agendamento, config) {
  agendamento = agendamento || {};
  config = config || {};
  var date = String(agendamento.data || '').slice(0, 10);
  if (agendamento.status !== 'agendado' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  var start = lembreteMinutos_(agendamento.hora);
  var opening = lembreteMinutos_(config.horaInicio || '08:00');
  var advance = Number(config.antecedenciaHoras) === 3 ? 3 : 4;
  if (!Number.isFinite(start) || !Number.isFinite(opening) || opening >= start) return '';
  var scheduled = Math.max(opening, start - advance * 60);
  if (scheduled >= start) return '';
  return date + 'T' + lembreteHora_(scheduled) + ':00';
}

function chaveLembreteAgendamento_(agendamento) {
  agendamento = agendamento || {};
  var id = String(agendamento.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  var date = String(agendamento.data || '').slice(0, 10);
  var time = String(agendamento.hora || '').slice(0, 5);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return '';
  return 'lembrete:' + id + ':' + date + ':' + time;
}

function renderizarMensagemLembrete_(modelo, dados) {
  dados = dados || {};
  var values = {
    nome:dados.nome,
    servico:dados.servico,
    salao:dados.salao,
    data:dados.data,
    hora:dados.hora
  };
  var rendered = String(modelo || '');
  Object.keys(values).forEach(function (key) {
    rendered = rendered.replace(new RegExp('\\{' + key + '\\}', 'g'), String(values[key] || ''));
  });
  return rendered.trim().slice(0, 2000);
}
