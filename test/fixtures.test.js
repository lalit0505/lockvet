import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyze, formatReport } from '../src/index.js';

test('real-world fixture: analyzes request@2.88.2 lockfile accurately', () => {
  const fixturePath = path.resolve('test/fixtures/request-package-lock.json');
  const content = fs.readFileSync(fixturePath, 'utf8');

  const report = analyze(content, { maxPaths: 3 });

  assert.ok(report.meta.packageCount > 30);
  assert.ok(report.meta.lockfileVersion >= 2);

  // Request itself is deprecated
  const deprecatedFindings = report.findings.filter((f) => f.rule === 'deprecated');
  assert.ok(deprecatedFindings.length > 0);

  const requestDep = deprecatedFindings.find((f) => f.name === 'request');
  assert.ok(requestDep);
  assert.equal(requestDep.severity, 'warning');
  assert.ok(requestDep.details.includes('request has been deprecated'));
  assert.ok(requestDep.paths.length > 0);

  // Test report formatting works cleanly
  const md = formatReport(report, { format: 'markdown' });
  assert.ok(md.includes('# 🛡️ lockvet Report'));
  assert.ok(md.includes('request'));

  const json = formatReport(report, { format: 'json' });
  const parsedJson = JSON.parse(json);
  assert.equal(parsedJson.schemaVersion, 1);
  assert.ok(parsedJson.summary.totalFindings > 0);
});
