import { parseLockfile } from './parse.js';
import { buildGraph, findPaths } from './graph.js';
import { evaluateRules } from './rules.js';
import { formatReport } from './formatters.js';
import { LockvetError } from './errors.js';

/**
 * Analyze an npm lockfile and generate a comprehensive triage report.
 *
 * @param {string | object} lockfileInput Raw JSON string or parsed object
 * @param {object} [options]
 * @param {number} [options.maxPaths=3]
 * @param {boolean} [options.prodOnly=false]
 * @param {string[]} [options.denyLicenses=[]]
 * @param {string[]} [options.allowLicenses=[]]
 * @param {Array<string | { package: string }>} [options.ignore=[]]
 * @param {number} [options.maxSizeBytes]
 * @returns {object} Report object with meta, findings, ignoredFindings, and summary
 */
export function analyze(lockfileInput, options = {}) {
  const parsed = parseLockfile(lockfileInput, options);
  const graph = buildGraph(parsed);
  const { findings, ignoredFindings, licenseSummary } = evaluateRules(graph, options);

  const errorsCount = findings.filter((f) => f.severity === 'error').length;
  const warningsCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  const byRule = Object.create(null);
  for (const f of findings) {
    byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  }

  // Count packages in packages map excluding root
  let packageCount = 0;
  if (parsed.packages && typeof parsed.packages === 'object') {
    for (const key of Object.keys(parsed.packages)) {
      if (key !== '') {
        packageCount++;
      }
    }
  }

  const meta = {
    lockfileVersion: parsed.lockfileVersion,
    packageCount,
    projectName: graph.root.name,
    projectVersion: graph.root.version,
    warnings: graph.warnings
  };

  const summary = {
    totalFindings: findings.length,
    errors: errorsCount,
    warnings: warningsCount,
    info: infoCount,
    byRule,
    licenses: licenseSummary
  };

  return {
    meta,
    findings,
    ignoredFindings,
    summary
  };
}

export { parseLockfile, buildGraph, findPaths, formatReport, LockvetError };
