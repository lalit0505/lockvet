import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/index.js';

test('rule: deprecated produces sanitized message, correct severity by scope, and fix targets', () => {
  const lockfile = {
    name: 'test-app',
    version: '1.0.0',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: { directProd: '1.0.0' },
        devDependencies: { directDev: '1.0.0' }
      },
      'node_modules/directProd': {
        version: '1.0.0',
        dependencies: { oldProdPkg: '0.1.0' }
      },
      'node_modules/oldProdPkg': {
        version: '0.1.0',
        deprecated: '\x1b[31mThis package is \x1b[1mdeprecated\x1b[0m! Use *new-pkg* instead.'
      },
      'node_modules/directDev': {
        version: '1.0.0',
        dev: true,
        dependencies: { oldDevPkg: '0.1.0' }
      },
      'node_modules/oldDevPkg': {
        version: '0.1.0',
        dev: true,
        deprecated: 'Dev tool deprecated'
      }
    }
  };

  const report = analyze(lockfile);
  const depFindings = report.findings.filter((f) => f.rule === 'deprecated');
  assert.equal(depFindings.length, 2);

  const prodFinding = depFindings.find((f) => f.name === 'oldProdPkg');
  assert.ok(prodFinding);
  assert.equal(prodFinding.severity, 'warning');
  assert.equal(prodFinding.scope, 'prod');
  assert.equal(prodFinding.details, 'This package is deprecated! Use *new-pkg* instead.');
  assert.ok(!prodFinding.details.includes('\x1b'));
  assert.deepEqual(prodFinding.fixTargets, ['directProd@1.0.0']);

  const devFinding = depFindings.find((f) => f.name === 'oldDevPkg');
  assert.ok(devFinding);
  assert.equal(devFinding.severity, 'info');
  assert.equal(devFinding.scope, 'dev');
});

test('rule: install-scripts flags packages with hasInstallScript: true', () => {
  const lockfile = {
    name: 'scripts-app',
    lockfileVersion: 2,
    packages: {
      '': { dependencies: { pkgWithScript: '1.0.0' } },
      'node_modules/pkgWithScript': {
        version: '1.0.0',
        hasInstallScript: true
      }
    }
  };

  const report = analyze(lockfile);
  const scriptFindings = report.findings.filter((f) => f.rule === 'install-scripts');
  assert.equal(scriptFindings.length, 1);
  assert.equal(scriptFindings[0].severity, 'info');
  assert.equal(scriptFindings[0].name, 'pkgWithScript');
});

test('rule: source detects insecure urls, non-registry https, and missing integrity', () => {
  const lockfile = {
    name: 'source-app',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: {
          gitPkg: '1.0.0',
          httpPkg: '1.0.0',
          githubTgzPkg: '1.0.0',
          noIntegrityPkg: '1.0.0',
          cleanRegistryPkg: '1.0.0'
        }
      },
      'node_modules/gitPkg': {
        version: '1.0.0',
        resolved: 'git+ssh://git@github.com/org/pkg.git#v1.0.0'
      },
      'node_modules/httpPkg': {
        version: '1.0.0',
        resolved: 'http://insecure.example.com/pkg.tgz'
      },
      'node_modules/githubTgzPkg': {
        version: '1.0.0',
        resolved: 'https://github.com/org/repo/archive/v1.0.0.tar.gz'
      },
      'node_modules/noIntegrityPkg': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/no-integrity/-/no-integrity-1.0.0.tgz'
      },
      'node_modules/cleanRegistryPkg': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/clean/-/clean-1.0.0.tgz',
        integrity: 'sha512-abc123=='
      }
    }
  };

  const report = analyze(lockfile);
  const srcFindings = report.findings.filter((f) => f.rule === 'source');

  // gitPkg -> warning
  const gitF = srcFindings.find((f) => f.name === 'gitPkg');
  assert.equal(gitF.severity, 'warning');

  // httpPkg -> warning
  const httpF = srcFindings.find((f) => f.name === 'httpPkg');
  assert.equal(httpF.severity, 'warning');

  // githubTgzPkg -> info (https non-registry)
  const ghF = srcFindings.find((f) => f.name === 'githubTgzPkg');
  assert.equal(ghF.severity, 'info');

  // noIntegrityPkg -> warning (registry missing integrity)
  const noIntegF = srcFindings.find((f) => f.name === 'noIntegrityPkg');
  assert.equal(noIntegF.severity, 'warning');

  // cleanRegistryPkg -> clean, no finding
  assert.ok(!srcFindings.some((f) => f.name === 'cleanRegistryPkg'));
});

test('rule: duplicates detects same package with 2+ different versions', () => {
  const lockfile = {
    name: 'dups-app',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: { a: '1.0.0', b: '1.0.0' }
      },
      'node_modules/a': {
        version: '1.0.0',
        dependencies: { lodash: '3.10.1' }
      },
      'node_modules/a/node_modules/lodash': {
        version: '3.10.1'
      },
      'node_modules/b': {
        version: '1.0.0',
        dependencies: { lodash: '4.17.21' }
      },
      'node_modules/lodash': {
        version: '4.17.21'
      }
    }
  };

  const report = analyze(lockfile);
  const dupFindings = report.findings.filter((f) => f.rule === 'duplicates');
  assert.equal(dupFindings.length, 1);
  assert.equal(dupFindings[0].name, 'lodash');
  assert.deepEqual(dupFindings[0].versions, ['3.10.1', '4.17.21']);
  assert.equal(dupFindings[0].severity, 'info');
  assert.ok(dupFindings[0].versionChains['3.10.1']);
  assert.ok(dupFindings[0].versionChains['4.17.21']);
});

test('rule: licenses builds summary and enforces deny-license and allow-license with OR/AND', () => {
  const lockfile = {
    name: 'lic-app',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: {
          pkgMit: '1.0.0',
          pkgDual: '1.0.0',
          pkgGpl: '1.0.0',
          pkgUnknown: '1.0.0'
        }
      },
      'node_modules/pkgMit': { version: '1.0.0', license: 'MIT' },
      'node_modules/pkgDual': { version: '1.0.0', license: '(MIT OR GPL-3.0)' },
      'node_modules/pkgGpl': { version: '1.0.0', license: 'GPL-3.0' },
      'node_modules/pkgUnknown': { version: '1.0.0' }
    }
  };

  // Base summary check
  const report = analyze(lockfile);
  assert.equal(report.summary.licenses['MIT'], 1);
  assert.equal(report.summary.licenses['(MIT OR GPL-3.0)'], 1);
  assert.equal(report.summary.licenses['GPL-3.0'], 1);
  assert.equal(report.summary.licenses['UNKNOWN'], 1);

  // Deny GPL-3.0: pkgGpl denied; pkgDual is NOT denied because MIT alternative is allowed
  const deniedReport = analyze(lockfile, { denyLicenses: ['GPL-3.0'] });
  const licDeniedFindings = deniedReport.findings.filter((f) => f.rule === 'license');
  assert.equal(licDeniedFindings.length, 1);
  assert.equal(licDeniedFindings[0].name, 'pkgGpl');

  // Allow only MIT: pkgMit allowed; pkgDual allowed (MIT alternative); pkgGpl & pkgUnknown violated
  const allowedReport = analyze(lockfile, { allowLicenses: ['MIT'] });
  const licAllowedFindings = allowedReport.findings.filter((f) => f.rule === 'license');
  assert.equal(licAllowedFindings.length, 2);
  const violatedNames = licAllowedFindings.map((f) => f.name).sort();
  assert.deepEqual(violatedNames, ['pkgGpl', 'pkgUnknown']);
});

test('option: prodOnly ignores dev-only packages', () => {
  const lockfile = {
    name: 'prod-check',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: { prodPkg: '1.0.0' },
        devDependencies: { devPkg: '1.0.0' }
      },
      'node_modules/prodPkg': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/prodPkg/-/prodPkg-1.0.0.tgz',
        integrity: 'sha512-test=='
      },
      'node_modules/devPkg': {
        version: '1.0.0',
        dev: true,
        resolved: 'https://registry.npmjs.org/devPkg/-/devPkg-1.0.0.tgz',
        integrity: 'sha512-test==',
        deprecated: 'Dev package deprecated'
      }
    }
  };

  const normalReport = analyze(lockfile);
  assert.equal(normalReport.findings.length, 1);

  const prodReport = analyze(lockfile, { prodOnly: true });
  assert.equal(prodReport.findings.length, 0);
});

test('option: ignore suppresses findings for package name or name@version', () => {
  const lockfile = {
    name: 'ignore-app',
    lockfileVersion: 2,
    packages: {
      '': { dependencies: { a: '1.0.0', b: '2.0.0' } },
      'node_modules/a': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
        integrity: 'sha512-test==',
        deprecated: 'dep a'
      },
      'node_modules/b': {
        version: '2.0.0',
        resolved: 'https://registry.npmjs.org/b/-/b-2.0.0.tgz',
        integrity: 'sha512-test==',
        deprecated: 'dep b'
      }
    }
  };

  const report = analyze(lockfile, {
    ignore: ['a', 'b@2.0.0']
  });
  assert.equal(report.findings.length, 0);
  assert.equal(report.ignoredFindings.length, 2);
});
