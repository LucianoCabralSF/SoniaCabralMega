const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const rules = require(path.join(projectRoot, 'rules.js'));

function loadBackendRules() {
  const source = fs.readFileSync(path.join(projectRoot, 'Regras.gs'), 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Regras.gs' });
  return context;
}

test('accepts real ISO and Brazilian dates', () => {
  assert.equal(rules.parseDate('2026-02-28'), '2026-02-28');
  assert.equal(rules.parseDate('28/02/2026'), '2026-02-28');
});

test('rejects empty and impossible dates', () => {
  assert.equal(rules.parseDate(''), '');
  assert.equal(rules.parseDate('31/02/2026'), '');
  assert.equal(rules.parseDate('2026-13-10'), '');
});

test('clamps monthly dates instead of skipping February', () => {
  assert.equal(rules.addMonthsClamped('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(rules.addMonthsClamped('2024-01-31', 1, 31), '2024-02-29');
  assert.equal(rules.addMonthsClamped('2026-01-01', 2, 31), '2026-03-31');
});

test('splits cents exactly and distributes the remainder', () => {
  assert.deepEqual(rules.splitMoney(10000, 3), [3334, 3333, 3333]);
  assert.equal(rules.splitMoney(10000, 3).reduce((sum, value) => sum + value, 0), 10000);
});

test('rejects invalid installment counts', () => {
  assert.throws(() => rules.splitMoney(10000, 0), /parcelas/i);
  assert.throws(() => rules.splitMoney(10000, 37), /parcelas/i);
  assert.throws(() => rules.splitMoney(2, 3), /centavo/i);
});

test('rejects overpayment', () => {
  assert.deepEqual(
    rules.validatePayment({ paymentCents: 15000, balanceCents: 10000 }),
    { ok: false, code: 'overpayment', message: 'O valor recebido não pode ser maior que o saldo.' }
  );
});

test('selected installment requires the exact open amount', () => {
  assert.equal(
    rules.validatePayment({ paymentCents: 100, balanceCents: 10000, installmentCents: 3333 }).code,
    'installment_mismatch'
  );
  assert.equal(
    rules.validatePayment({ paymentCents: 3333, balanceCents: 10000, installmentCents: 3333 }).ok,
    true
  );
});

test('partial payment without an installment remains valid', () => {
  assert.equal(rules.validatePayment({ paymentCents: 100, balanceCents: 10000 }).ok, true);
});

test('partial payments settle oldest installments and reduce the next one', () => {
  assert.deepEqual(rules.allocatePayment([10000, 10000, 5000], 15000), [
    { originalCents: 10000, appliedCents: 10000, remainingCents: 0, paid: true },
    { originalCents: 10000, appliedCents: 5000, remainingCents: 5000, paid: false },
    { originalCents: 5000, appliedCents: 0, remainingCents: 5000, paid: false }
  ]);
});

test('escapes untrusted HTML and attributes', () => {
  assert.equal(
    rules.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(rules.escapeAttr("a'b\"<c>"), 'a&#39;b&quot;&lt;c&gt;');
});

test('idempotency keys are non-empty and unique', () => {
  const a = rules.makeIdempotencyKey('cred');
  const b = rules.makeIdempotencyKey('cred');
  assert.match(a, /^cred_[a-zA-Z0-9_-]{12,}$/);
  assert.notEqual(a, b);
});

test('backend pure rules match frontend behavior', () => {
  const backend = loadBackendRules();
  assert.equal(backend.dataMensalLimitada_('2026-01-31', 1, 31), '2026-02-28');
  assert.deepEqual(Array.from(backend.dividirCentavos_(10000, 3)), [3334, 3333, 3333]);
  assert.throws(() => backend.dividirCentavos_(2, 3), /centavo/i);
  assert.equal(backend.validarDataISO_('2026-02-31'), false);
  assert.equal(backend.validarPagamento_(15000, 10000, null).code, 'overpayment');
  const allocation = Array.from(backend.alocarPagamento_([10000, 10000], 15000));
  assert.equal(allocation[0].pago, true);
  assert.equal(allocation[1].restanteCentavos, 5000);
});
