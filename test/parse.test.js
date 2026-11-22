import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLockfile, LockvetError } from '../src/index.js';

test('parseLockfile parses valid lockfileVersion 2 and 3', () => {
  const v2 = {
    name: 'test-v2',
    version: '1.0.0',
    lockfileVersion: 2,
    packages: {
      '': { name: 'test-v2', version: '1.0.0' },
      'node_modules/foo': { version: '1.2.3' }
    }
  };
  const parsed2 = parseLockfile(JSON.stringify(v2));
  assert.equal(parsed2.lockfileVersion, 2);
  assert.equal(parsed2.name, 'test-v2');

  const v3 = {
    name: 'test-v3',
    version: '2.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'test-v3', version: '2.0.0' }
    }
  };
  const parsed3 = parseLockfile(v3);
  assert.equal(parsed3.lockfileVersion, 3);
});

test('parseLockfile rejects lockfileVersion 1 with specific message', () => {
  const v1 = {
    name: 'legacy',
    version: '1.0.0',
    lockfileVersion: 1,
    dependencies: {}
  };
  assert.throws(
    () => parseLockfile(v1),
    (err) => {
      assert.ok(err instanceof LockvetError);
      assert.equal(err.code, 'ERR_UNSUPPORTED_VERSION');
      assert.equal(err.message, 'unsupported lockfile version 1, regenerate with npm >= 7');
      return true;
    }
  );
});

test('parseLockfile rejects unsupported versions', () => {
  assert.throws(() => parseLockfile({ lockfileVersion: 4, packages: {} }), {
    code: 'ERR_UNSUPPORTED_VERSION'
  });
});

test('parseLockfile rejects invalid JSON', () => {
  assert.throws(() => parseLockfile('{ invalid json'), { code: 'ERR_INVALID_JSON' });
});

test('parseLockfile rejects non-object input', () => {
  assert.throws(() => parseLockfile('["array"]'), { code: 'ERR_INVALID_LOCKFILE' });
  assert.throws(() => parseLockfile(null), { code: 'ERR_INVALID_LOCKFILE' });
  assert.throws(() => parseLockfile(42), { code: 'ERR_INVALID_LOCKFILE' });
});

test('parseLockfile rejects missing packages map', () => {
  assert.throws(() => parseLockfile({ lockfileVersion: 2 }), { code: 'ERR_INVALID_LOCKFILE' });
});

test('parseLockfile enforces maxSizeBytes', () => {
  const raw = JSON.stringify({ lockfileVersion: 2, packages: {} });
  assert.throws(() => parseLockfile(raw, { maxSizeBytes: 10 }), { code: 'ERR_INPUT_TOO_LARGE' });
});
