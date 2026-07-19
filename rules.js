(function initSoniaRules(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SoniaRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSoniaRules(root) {
  'use strict';

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function isValidIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
  }

  function parseDate(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    if (isValidIsoDate(input)) return input;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
    if (!match) return '';
    const iso = `${match[3]}-${match[2]}-${match[1]}`;
    return isValidIsoDate(iso) ? iso : '';
  }

  function addMonthsClamped(startIso, monthOffset, preferredDay) {
    const normalized = parseDate(startIso);
    if (!normalized) throw new Error('Data inicial inválida.');
    if (!Number.isInteger(monthOffset)) throw new Error('Deslocamento mensal inválido.');

    const [year, month, originalDay] = normalized.split('-').map(Number);
    const targetIndex = year * 12 + (month - 1) + monthOffset;
    const targetYear = Math.floor(targetIndex / 12);
    const targetMonthIndex = ((targetIndex % 12) + 12) % 12;
    const targetMonth = targetMonthIndex + 1;
    const desiredDay = Number.isInteger(preferredDay) ? preferredDay : originalDay;
    if (desiredDay < 1 || desiredDay > 31) throw new Error('Dia de vencimento inválido.');
    const day = Math.min(desiredDay, daysInMonth(targetYear, targetMonth));
    return `${targetYear}-${pad2(targetMonth)}-${pad2(day)}`;
  }

  function splitMoney(totalCents, count, maxCount = 36) {
    if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('Total em centavos inválido.');
    if (!Number.isInteger(count) || count < 1 || count > maxCount) throw new Error('Número de parcelas inválido.');
    if (totalCents > 0 && count > totalCents) throw new Error('Cada parcela precisa ter ao menos um centavo.');
    const base = Math.floor(totalCents / count);
    const remainder = totalCents % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  function validatePayment({ paymentCents, balanceCents, installmentCents = null }) {
    if (!Number.isInteger(paymentCents) || paymentCents <= 0) {
      return { ok: false, code: 'invalid_payment', message: 'Informe um valor recebido válido.' };
    }
    if (!Number.isInteger(balanceCents) || balanceCents < 0) {
      return { ok: false, code: 'invalid_balance', message: 'O saldo do fiado é inválido.' };
    }
    if (paymentCents > balanceCents) {
      return { ok: false, code: 'overpayment', message: 'O valor recebido não pode ser maior que o saldo.' };
    }
    if (installmentCents !== null && paymentCents !== installmentCents) {
      return { ok: false, code: 'installment_mismatch', message: 'Para baixar a parcela, receba exatamente o valor dela. Para pagamento parcial, selecione “sem parcela”.' };
    }
    return { ok: true, code: 'ok', message: '' };
  }

  function allocatePayment(openInstallmentCents, paymentCents) {
    const values = Array.from(openInstallmentCents || []);
    if (!values.length || values.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Parcelas abertas inválidas.');
    if (!Number.isInteger(paymentCents) || paymentCents <= 0 || paymentCents > values.reduce((sum, value) => sum + value, 0)) {
      throw new Error('Pagamento inválido para as parcelas abertas.');
    }
    let pendingPayment = paymentCents;
    return values.map(originalCents => {
      const appliedCents = Math.min(originalCents, pendingPayment);
      pendingPayment -= appliedCents;
      const remainingCents = originalCents - appliedCents;
      return { originalCents, appliedCents, remainingCents, paid: remainingCents === 0 };
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function makeIdempotencyKey(prefix = 'op') {
    let randomPart = '';
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      randomPart = root.crypto.randomUUID().replace(/-/g, '');
    } else if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      randomPart = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      randomPart = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    }
    return `${String(prefix || 'op').replace(/[^a-zA-Z0-9_-]/g, '')}_${randomPart}`;
  }

  return Object.freeze({
    addMonthsClamped,
    allocatePayment,
    escapeAttr,
    escapeHtml,
    isValidIsoDate,
    makeIdempotencyKey,
    parseDate,
    splitMoney,
    validatePayment
  });
});
