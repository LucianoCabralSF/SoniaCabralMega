// Regras puras da Central de Relacionamento.
// Este arquivo não depende de SpreadsheetApp e pode ser executado nos testes Node.

var REL_ETAPAS_ = ['pendente', 'contatada', 'respondeu', 'agendou', 'retornou'];

function relDateMs_(iso) {
  var value = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  var parts = value.split('-').map(Number);
  var ms = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  var date = new Date(ms);
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2]
  ) return NaN;
  return ms;
}

function normalizarTelefoneWhatsApp_(telefone) {
  var digits = String(telefone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return /^55\d{10,11}$/.test(digits) ? digits : '';
}

function filaRelacionamento_(oportunidade, hojeIso) {
  if (!oportunidade || oportunidade.encerramentoMotivo || oportunidade.etapa === 'retornou') {
    return 'encerrado';
  }
  var hojeMs = relDateMs_(hojeIso);
  var alvoMs = relDateMs_(oportunidade.dataAlvo);
  if (!Number.isFinite(hojeMs) || !Number.isFinite(alvoMs)) return 'futuro';
  var atrasoDias = Math.floor((hojeMs - alvoMs) / 86400000);
  if (atrasoDias >= 15) return 'recuperacao';
  if (atrasoDias >= -7) return 'proximo';
  return 'futuro';
}

function selecionarOportunidadeParaAgendamento_(oportunidades, dados) {
  dados = dados || {};
  var etapasElegiveis = { contatada:true, respondeu:true };
  var lista = (oportunidades || []).filter(function (item) {
    return String(item.clienteId) === String(dados.clienteId) &&
      etapasElegiveis[item.etapa] &&
      !item.agendamentoId &&
      !item.encerramentoMotivo &&
      String(item.criadoEm || '') <= String(dados.criadoEm || '');
  });

  if (dados.oportunidadeId) {
    var explicita = lista.find(function (item) {
      return String(item.id) === String(dados.oportunidadeId);
    });
    if (explicita) return explicita;
  }

  lista.sort(function (a, b) {
    var prioridadeA = a.origem === 'retorno' ? 0 : 1;
    var prioridadeB = b.origem === 'retorno' ? 0 : 1;
    return prioridadeA - prioridadeB ||
      String(a.dataAlvo || '').localeCompare(String(b.dataAlvo || '')) ||
      String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''));
  });
  return lista[0] || null;
}

function relMediaHoras_(itens, inicio, fim) {
  var intervalos = (itens || []).filter(function (item) {
    return item[inicio] && item[fim];
  }).map(function (item) {
    return (new Date(item[fim]).getTime() - new Date(item[inicio]).getTime()) / 3600000;
  }).filter(function (value) {
    return Number.isFinite(value) && value >= 0;
  });
  if (!intervalos.length) return 0;
  return intervalos.reduce(function (sum, value) { return sum + value; }, 0) / intervalos.length;
}

function calcularIndicadoresRelacionamento_(oportunidades) {
  var rank = { pendente:0, contatada:1, respondeu:2, agendou:3, retornou:4 };
  var elegiveis = (oportunidades || []).filter(function (item) {
    return !item.encerramentoMotivo;
  });
  var out = {
    elegiveis:0,
    contatadas:0,
    responderam:0,
    agendaram:0,
    retornaram:0,
    recuperadas:0
  };

  elegiveis.forEach(function (item) {
    var value = rank[item.etapa] || 0;
    out.elegiveis += 1;
    if (value >= 1) out.contatadas += 1;
    if (value >= 2) out.responderam += 1;
    if (value >= 3) out.agendaram += 1;
    if (value >= 4) out.retornaram += 1;
    if (value >= 4 && (item.recuperacaoAoContatar === true || item.recuperacaoAoContatar === 'true')) {
      out.recuperadas += 1;
    }
  });

  out.taxaContato = out.elegiveis ? out.contatadas / out.elegiveis : 0;
  out.taxaResposta = out.contatadas ? out.responderam / out.contatadas : 0;
  out.taxaAgendamento = out.responderam ? out.agendaram / out.responderam : 0;
  out.taxaRetorno = out.agendaram ? out.retornaram / out.agendaram : 0;
  out.mediaHorasContatoAgendamento = relMediaHoras_(elegiveis, 'contatadaEm', 'agendouEm');
  out.mediaHorasAgendamentoRetorno = relMediaHoras_(elegiveis, 'agendouEm', 'retornouEm');
  return out;
}
