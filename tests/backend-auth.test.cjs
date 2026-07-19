const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backend = fs.readFileSync(path.join(__dirname, '..', 'Código.gs'), 'utf8');

function backendFixture(legacyPassword) {
  const cacheValues = new Map();
  const propertyValues = new Map();
  const sheetValues = [
    ['chave', 'valor'],
    ['senha', legacyPassword],
    ['salonName', 'Sonia Cabral'],
    ['tokenTTL', '2592000']
  ];
  let uuidCounter = 0;
  let scriptLockCount = 0;
  let sleepCount = 0;

  const cache = {
    get: key => cacheValues.has(key) ? cacheValues.get(key) : null,
    put: (key, value) => cacheValues.set(key, String(value)),
    remove: key => cacheValues.delete(key)
  };
  const properties = {
    getProperty: key => propertyValues.has(key) ? propertyValues.get(key) : null,
    setProperty: (key, value) => propertyValues.set(key, String(value)),
    setProperties: values => Object.entries(values).forEach(([key, value]) => propertyValues.set(key, String(value))),
    deleteProperty: key => propertyValues.delete(key),
    getProperties: () => Object.fromEntries(propertyValues)
  };
  const range = (row, column, rows = 1, columns = 1) => ({
    getValue: () => sheetValues[row - 1]?.[column - 1] ?? '',
    setValue(value) { sheetValues[row - 1][column - 1] = value; return this; },
    getValues: () => Array.from({ length: rows }, (_, rowOffset) =>
      Array.from({ length: columns }, (_, columnOffset) =>
        sheetValues[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? '')),
    setValues(values) {
      values.forEach((valuesRow, rowOffset) => valuesRow.forEach((value, columnOffset) => {
        if (!sheetValues[row - 1 + rowOffset]) sheetValues[row - 1 + rowOffset] = [];
        sheetValues[row - 1 + rowOffset][column - 1 + columnOffset] = value;
      }));
      return this;
    }
  });
  const sheet = {
    getLastRow: () => sheetValues.length,
    getLastColumn: () => sheetValues[0].length,
    getRange: range
  };
  const lock = { waitLock() {}, releaseLock() {} };

  const context = vm.createContext({
    console,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: name => name === 'config' ? sheet : null,
        insertSheet: () => { throw new Error('Unexpected sheet creation'); }
      })
    },
    LockService: {
      getDocumentLock: () => lock,
      getScriptLock: () => {
        scriptLockCount += 1;
        return lock;
      }
    },
    Session: { getScriptTimeZone: () => 'America/Manaus' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      formatDate: date => new Date(date).toISOString().slice(0, 19),
      sleep: () => { sleepCount += 1; }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: value => ({
        value: String(value),
        setMimeType() { return this; }
      })
    }
  });
  vm.runInContext(backend, context);

  return {
    call: expression => vm.runInContext(expression, context),
    parse: response => JSON.parse(response.value),
    propertyValues,
    sheetValues,
    getScriptLockCount: () => scriptLockCount,
    getSleepCount: () => sleepCount
  };
}

test('migrates the legacy four-character password without locking the salon out', () => {
  const fixture = backendFixture('1234');
  const response = fixture.parse(fixture.call("authLogic('1234', false)"));

  assert.equal(response.status, 'ok');
  assert.ok(fixture.propertyValues.get('auth_password_hash'));
  assert.ok(fixture.propertyValues.get('auth_password_salt'));
  assert.equal(fixture.sheetValues[1][1], '');
});

test('serializes failed-login counting while still allowing the correct password', () => {
  const fixture = backendFixture('senha-segura');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    fixture.call("authLogic('senha-errada', false)");
  }
  const blockedWrongPassword = fixture.parse(fixture.call("authLogic('outra-senha-errada', false)"));
  const correctPassword = fixture.parse(fixture.call("authLogic('senha-segura', false)"));

  assert.match(blockedWrongPassword.data.message, /Muitas tentativas/);
  assert.equal(correctPassword.status, 'ok');
  assert.ok(fixture.getScriptLockCount() >= 6);
  assert.ok(fixture.getSleepCount() >= 2);
});
