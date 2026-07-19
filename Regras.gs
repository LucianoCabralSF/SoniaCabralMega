// Regras puras compartilhadas pelo backend. Este arquivo não acessa planilhas.

function diasNoMes_(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function pad2_(valor) {
  return String(valor).padStart(2, '0');
}

function validarDataISO_(valor) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || '').trim());
  if (!match) return false;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  return ano >= 1900 && ano <= 2200 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes_(ano, mes);
}

function normalizarDataEstrita_(valor) {
  const entrada = String(valor || '').trim();
  if (!entrada) return '';
  if (validarDataISO_(entrada)) return entrada;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(entrada);
  if (!match) return '';
  const iso = match[3] + '-' + match[2] + '-' + match[1];
  return validarDataISO_(iso) ? iso : '';
}

function dataMensalLimitada_(dataInicio, deslocamento, diaPreferido) {
  const normalizada = normalizarDataEstrita_(dataInicio);
  if (!normalizada) throw new Error('Data inicial inválida.');
  if (!Number.isInteger(deslocamento)) throw new Error('Deslocamento mensal inválido.');

  const partes = normalizada.split('-').map(Number);
  const indiceAlvo = partes[0] * 12 + (partes[1] - 1) + deslocamento;
  const anoAlvo = Math.floor(indiceAlvo / 12);
  const indiceMesAlvo = ((indiceAlvo % 12) + 12) % 12;
  const mesAlvo = indiceMesAlvo + 1;
  const diaDesejado = Number.isInteger(diaPreferido) ? diaPreferido : partes[2];
  if (diaDesejado < 1 || diaDesejado > 31) throw new Error('Dia de vencimento inválido.');
  const dia = Math.min(diaDesejado, diasNoMes_(anoAlvo, mesAlvo));
  return anoAlvo + '-' + pad2_(mesAlvo) + '-' + pad2_(dia);
}

function paraCentavos_(valor) {
  const numero = Number(String(valor == null ? '' : valor).replace(',', '.'));
  if (!Number.isFinite(numero)) throw new Error('Valor monetário inválido.');
  return Math.round(numero * 100);
}

function deCentavos_(centavos) {
  if (!Number.isInteger(centavos)) throw new Error('Valor em centavos inválido.');
  return centavos / 100;
}

function dividirCentavos_(totalCentavos, quantidade, maximo) {
  const limite = Number.isInteger(maximo) ? maximo : 36;
  if (!Number.isInteger(totalCentavos) || totalCentavos < 0) throw new Error('Total em centavos inválido.');
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > limite) throw new Error('Número de parcelas inválido.');
  if (totalCentavos > 0 && quantidade > totalCentavos) throw new Error('Cada parcela precisa ter ao menos um centavo.');
  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos % quantidade;
  return Array.from({ length: quantidade }, function (_, indice) {
    return base + (indice < resto ? 1 : 0);
  });
}

function validarPagamento_(pagamentoCentavos, saldoCentavos, parcelaCentavos) {
  if (!Number.isInteger(pagamentoCentavos) || pagamentoCentavos <= 0) {
    return { ok: false, code: 'invalid_payment', message: 'Informe um valor recebido válido.' };
  }
  if (!Number.isInteger(saldoCentavos) || saldoCentavos < 0) {
    return { ok: false, code: 'invalid_balance', message: 'O saldo do fiado é inválido.' };
  }
  if (pagamentoCentavos > saldoCentavos) {
    return { ok: false, code: 'overpayment', message: 'O valor recebido não pode ser maior que o saldo.' };
  }
  if (parcelaCentavos !== null && typeof parcelaCentavos !== 'undefined' && pagamentoCentavos !== parcelaCentavos) {
    return { ok: false, code: 'installment_mismatch', message: 'Para baixar a parcela, receba exatamente o valor dela. Para pagamento parcial, selecione “sem parcela”.' };
  }
  return { ok: true, code: 'ok', message: '' };
}

function alocarPagamento_(parcelasAbertasCentavos, pagamentoCentavos) {
  const valores = Array.from(parcelasAbertasCentavos || []);
  const total = valores.reduce(function (sum, value) {
    if (!Number.isInteger(value) || value < 0) throw new Error('Parcelas abertas inválidas.');
    return sum + value;
  }, 0);
  if (!valores.length || !Number.isInteger(pagamentoCentavos) || pagamentoCentavos <= 0 || pagamentoCentavos > total) {
    throw new Error('Pagamento inválido para as parcelas abertas.');
  }
  let pendente = pagamentoCentavos;
  return valores.map(function (originalCentavos) {
    const aplicadoCentavos = Math.min(originalCentavos, pendente);
    pendente -= aplicadoCentavos;
    const restanteCentavos = originalCentavos - aplicadoCentavos;
    return { originalCentavos: originalCentavos, aplicadoCentavos: aplicadoCentavos, restanteCentavos: restanteCentavos, pago: restanteCentavos === 0 };
  });
}
