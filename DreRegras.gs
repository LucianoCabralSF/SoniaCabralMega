var DRE_CATEGORIAS_ = [
  'receita_servicos','receita_produtos','outras_receitas','deducoes',
  'custos_variaveis','despesas_pessoal','despesas_estrutura',
  'despesas_operacionais','resultado_financeiro','retirada','fora_dre'
];

function dreCentavos_(value) {
  var number = Number(String(value == null ? 0 : value).replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function classificarMovimentoDre_(movement, mappings) {
  movement = movement || {};
  if (movement.isRetirada === true || movement.isRetirada === 'true' || movement.categoria === 'Retirada Pessoal') return 'retirada';
  if (DRE_CATEGORIAS_.indexOf(movement.dreCategoria) >= 0) return movement.dreCategoria;
  var mapping = (mappings || []).find(function (rule) {
    return rule.ativo !== 'false' &&
      (!rule.tipo || rule.tipo === movement.tipo) &&
      (!rule.categoriaCaixa || rule.categoriaCaixa === movement.categoria) &&
      (!rule.itemTipo || rule.itemTipo === movement.itemTipo);
  });
  if (mapping && DRE_CATEGORIAS_.indexOf(mapping.dreCategoria) >= 0) return mapping.dreCategoria;
  if (movement.tipo === 'entrada' && (movement.itemTipo === 'agendamento' || movement.itemTipo === 'servico')) return 'receita_servicos';
  if (movement.tipo === 'entrada' && movement.itemTipo === 'produto') return 'receita_produtos';
  if (movement.tipo === 'saida' && ['Aluguel','Manutenção'].indexOf(movement.categoria) >= 0) return 'despesas_estrutura';
  if (movement.tipo === 'saida' && ['Material','Compra de produto'].indexOf(movement.categoria) >= 0) return 'custos_variaveis';
  if (movement.tipo === 'saida' && movement.categoria === 'Salário') return 'despesas_pessoal';
  return 'nao_classificado';
}

function novaLinhaDre_() {
  return { meses:Array(12).fill(0), total:0 };
}

function valorLinhaDre_(movement, category, cents) {
  if (category === 'resultado_financeiro') return movement.tipo === 'saida' ? -cents : cents;
  if (['deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','retirada'].indexOf(category) >= 0) {
    return movement.tipo === 'entrada' ? -cents : cents;
  }
  return movement.tipo === 'saida' ? -cents : cents;
}

function montarDreAnual_(movements, mappings, year) {
  var lines = {};
  DRE_CATEGORIAS_.concat(['nao_classificado','receita_liquida','margem_contribuicao','resultado_liquido','resultado_apos_retiradas']).forEach(function (key) {
    lines[key] = novaLinhaDre_();
  });
  var classified = [];
  var rawEligible = 0;
  var unclassifiedIn = 0;
  var unclassifiedOut = 0;
  var monthsWithMovement = {};
  (movements || []).forEach(function (movement) {
    var iso = String(movement.data || '').slice(0, 10);
    if (Number(iso.slice(0, 4)) !== Number(year)) return;
    var month = Number(iso.slice(5, 7)) - 1;
    if (month < 0 || month > 11) return;
    var category = classificarMovimentoDre_(movement, mappings);
    var cents = dreCentavos_(movement.valor);
    var sign = movement.tipo === 'saida' ? -1 : 1;
    if (category !== 'fora_dre') rawEligible += sign * cents;
    if (category !== 'fora_dre') monthsWithMovement[month] = true;
    if (category === 'nao_classificado') {
      if (movement.tipo === 'entrada') unclassifiedIn += cents;
      else unclassifiedOut += cents;
      lines.nao_classificado.meses[month] += sign * cents;
    } else if (category !== 'fora_dre') {
      lines[category].meses[month] += valorLinhaDre_(movement, category, cents);
    }
    classified.push(Object.assign({}, movement, { dreCategoriaResolvida:category, mes:month, valorCentavos:cents }));
  });
  for (var month = 0; month < 12; month += 1) {
    lines.receita_liquida.meses[month] =
      lines.receita_servicos.meses[month] + lines.receita_produtos.meses[month] +
      lines.outras_receitas.meses[month] - lines.deducoes.meses[month];
    lines.margem_contribuicao.meses[month] =
      lines.receita_liquida.meses[month] - lines.custos_variaveis.meses[month];
    lines.resultado_liquido.meses[month] =
      lines.margem_contribuicao.meses[month] - lines.despesas_pessoal.meses[month] -
      lines.despesas_estrutura.meses[month] - lines.despesas_operacionais.meses[month] +
      lines.resultado_financeiro.meses[month];
    lines.resultado_apos_retiradas.meses[month] =
      lines.resultado_liquido.meses[month] - lines.retirada.meses[month];
  }
  Object.keys(lines).forEach(function (key) {
    lines[key].total = lines[key].meses.reduce(function (sum, value) { return sum + value; }, 0);
  });
  var unclassifiedNet = unclassifiedIn - unclassifiedOut;
  var explained = lines.resultado_apos_retiradas.total + unclassifiedNet;
  var activeMonths = Object.keys(monthsWithMovement).map(Number);
  var sorted = activeMonths.slice().sort(function (a, b) {
    return lines.resultado_liquido.meses[a] - lines.resultado_liquido.meses[b];
  });
  return {
    ano:Number(year), linhas:lines, movimentosClassificados:classified,
    provisoria:unclassifiedIn + unclassifiedOut > 0,
    naoClassificados:{ entradas:unclassifiedIn, saidas:unclassifiedOut, saldo:unclassifiedNet },
    conciliacao:{ variacaoBrutaElegivel:rawEligible, totalExplicado:explained, diferencaTecnica:rawEligible - explained },
    indicadores:{
      faturamento:lines.receita_servicos.total + lines.receita_produtos.total + lines.outras_receitas.total,
      resultado:lines.resultado_liquido.total,
      margem:lines.receita_liquida.total ? lines.resultado_liquido.total / lines.receita_liquida.total : 0,
      melhorMes:sorted.length ? sorted[sorted.length - 1] : null,
      piorMes:sorted.length ? sorted[0] : null
    }
  };
}
