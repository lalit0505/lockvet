import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI_PATH = path.resolve('bin/lockvet.js');

function runCli(args = [], options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : ''
    };
  }
}

test('CLI: --help and --version exit 0', () => {
  const helpRes = runCli(['--help']);
  assert.equal(helpRes.status, 0);
  assert.ok(helpRes.stdout.includes('lockvet [path] [options]'));

  const verRes = runCli(['-v']);
  assert.equal(verRes.status, 0);
  assert.ok(verRes.stdout.startsWith('v1.'));
});

test('CLI: missing file exits with code 2', () => {
  const res = runCli(['/non/existent/path/package-lock.json']);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('error: Lockfile not found'));
});

test('CLI: formats (text, json, markdown) exit 0 on clean lockfile', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockvet-test-'));
  const lockPath = path.join(tmpDir, 'package-lock.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      name: 'clean-app',
      version: '1.0.0',
      lockfileVersion: 2,
      packages: {
        '': { name: 'clean-app' },
        'node_modules/clean-pkg': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/clean-pkg/-/clean-pkg-1.0.0.tgz',
          integrity: 'sha512-test=='
        }
      }
    })
  );

  // Text
  const textRes = runCli([lockPath, '--format', 'text']);
  assert.equal(textRes.status, 0);
  assert.ok(textRes.stdout.includes('lockvet'));
  assert.ok(textRes.stdout.includes('clean'));

  // JSON
  const jsonRes = runCli([lockPath, '--format', 'json']);
  assert.equal(jsonRes.status, 0);
  const parsed = JSON.parse(jsonRes.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.summary.totalFindings, 0);

  // Markdown
  const mdRes = runCli([lockPath, '--format', 'markdown']);
  assert.equal(mdRes.status, 0);
  assert.ok(mdRes.stdout.includes('# 🛡️ lockvet Report'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI: --fail-on exits 1 when violated, 0 when rule does not match', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockvet-test-'));
  const lockPath = path.join(tmpDir, 'package-lock.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      name: 'dep-app',
      lockfileVersion: 2,
      packages: {
        '': { dependencies: { old: '1.0.0' } },
        'node_modules/old': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/old/-/old-1.0.0.tgz',
          integrity: 'sha512-test==',
          deprecated: 'old pkg'
        }
      }
    })
  );

  // Without fail-on: exit 0
  const okRes = runCli([lockPath]);
  assert.equal(okRes.status, 0);

  // With fail-on matching: exit 1
  const failRes = runCli([lockPath, '--fail-on', 'deprecated']);
  assert.equal(failRes.status, 1);

  // With fail-on different rule: exit 0
  const nonMatchRes = runCli([lockPath, '--fail-on', 'source']);
  assert.equal(nonMatchRes.status, 0);

  // With ignore: suppresses violation, exits 0
  const ignoreRes = runCli([lockPath, '--fail-on', 'deprecated', '--ignore', 'old']);
  assert.equal(ignoreRes.status, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI: unsupported lockfileVersion 1 exits 2 with clear error', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockvet-test-'));
  const lockPath = path.join(tmpDir, 'package-lock.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      name: 'v1-app',
      lockfileVersion: 1,
      dependencies: {}
    })
  );

  const res = runCli([lockPath]);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('unsupported lockfile version 1, regenerate with npm >= 7'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI: respects .lockvetrc.json configuration file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockvet-test-'));
  const lockPath = path.join(tmpDir, 'package-lock.json');
  const rcPath = path.join(tmpDir, '.lockvetrc.json');

  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      name: 'rc-app',
      lockfileVersion: 2,
      packages: {
        '': { dependencies: { bad: '1.0.0' } },
        'node_modules/bad': {
          version: '1.0.0',
          deprecated: 'bad pkg'
        }
      }
    })
  );

  // Config with failOn
  fs.writeFileSync(
    rcPath,
    JSON.stringify({
      failOn: ['deprecated']
    })
  );

  const failRes = runCli([lockPath]);
  assert.equal(failRes.status, 1);

  // Config with ignore
  fs.writeFileSync(
    rcPath,
    JSON.stringify({
      failOn: ['deprecated'],
      ignore: [{ package: 'bad', reason: 'known acceptable risk' }]
    })
  );

  const okRes = runCli([lockPath]);
  assert.equal(okRes.status, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI: NO_COLOR environment variable disables color codes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockvet-test-'));
  const lockPath = path.join(tmpDir, 'package-lock.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      name: 'color-app',
      lockfileVersion: 2,
      packages: {
        '': { dependencies: { pkg: '1.0.0' } },
        'node_modules/pkg': { version: '1.0.0', deprecated: 'msg' }
      }
    })
  );

  const res = runCli([lockPath], {
    env: { ...process.env, NO_COLOR: '1' }
  });
  assert.equal(res.status, 0);
  assert.ok(!res.stdout.includes('\x1b['));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
