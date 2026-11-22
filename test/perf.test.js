import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/index.js';

test('performance: analyzes 5,000-package synthetic lockfile in under 3 seconds', () => {
  const packages = Object.create(null);
  packages[''] = {
    name: 'large-synth-project',
    version: '1.0.0',
    dependencies: {}
  };

  const TOTAL_PACKAGES = 5000;
  for (let i = 1; i <= TOTAL_PACKAGES; i++) {
    const pkgName = `pkg-${i}`;
    const installPath = `node_modules/${pkgName}`;
    const nextDepName = i < TOTAL_PACKAGES ? `pkg-${i + 1}` : null;

    if (i <= 50) {
      packages[''].dependencies[pkgName] = '1.0.0';
    }

    packages[installPath] = {
      version: '1.0.0',
      license: i % 2 === 0 ? 'MIT' : 'Apache-2.0',
      resolved: `https://registry.npmjs.org/${pkgName}/-/${pkgName}-1.0.0.tgz`,
      integrity: 'sha512-synth==',
      dependencies: nextDepName ? { [nextDepName]: '1.0.0' } : {}
    };

    if (i % 500 === 0) {
      packages[installPath].deprecated = `Synthetic deprecation on ${pkgName}`;
    }
  }

  const lockfile = {
    name: 'large-synth-project',
    version: '1.0.0',
    lockfileVersion: 2,
    packages
  };

  const startTime = performance.now();
  const report = analyze(lockfile, { maxPaths: 2 });
  const durationMs = performance.now() - startTime;

  assert.equal(report.meta.packageCount, TOTAL_PACKAGES);
  assert.ok(report.findings.length > 0);
  assert.ok(
    durationMs < 3000,
    `Analysis took ${durationMs.toFixed(2)}ms, exceeding 3000ms threshold`
  );
});
