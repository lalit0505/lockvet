import { escapeMarkdown, sanitizeString } from './sanitize.js';

/**
 * Format report as JSON string.
 *
 * @param {object} report
 * @returns {string}
 */
export function formatJson(report) {
  const output = {
    schemaVersion: 1,
    meta: report.meta,
    summary: report.summary,
    findings: report.findings,
    ignoredFindings: report.ignoredFindings || []
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Format report as GitHub-flavored Markdown.
 *
 * @param {object} report
 * @returns {string}
 */
export function formatMarkdown(report) {
  const lines = [];
  const meta = report.meta || {};
  const summary = report.summary || {};
  const findings = report.findings || [];

  lines.push('# 🛡️ lockvet Report');
  lines.push('');
  lines.push(
    `**Project:** \`${escapeMarkdown(meta.projectName || 'root')}\` | **Lockfile Version:** ${meta.lockfileVersion || 'unknown'} | **Packages:** ${meta.packageCount || 0}`
  );
  lines.push('');
  lines.push('### Overview');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| :--- | :--- |');
  lines.push(`| 🔴 Errors | ${summary.errors || 0} |`);
  lines.push(`| 🟡 Warnings | ${summary.warnings || 0} |`);
  lines.push(`| ℹ️ Info | ${summary.info || 0} |`);
  lines.push(`| 📦 Total Findings | ${summary.totalFindings || 0} |`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('🎉 **No findings detected. Lockfile is clean!**');
    lines.push('');
  } else {
    lines.push('### Findings');
    lines.push('');
    lines.push('| Severity | Rule | Package | Version | Scope | Details |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const f of findings) {
      const sevIcon =
        f.severity === 'error' ? '🔴 Error' : f.severity === 'warning' ? '🟡 Warning' : 'ℹ️ Info';
      const pkgName = escapeMarkdown(f.name);
      const version = escapeMarkdown(f.version);
      const scope = escapeMarkdown(f.scope || 'prod');
      const details = escapeMarkdown(f.details);
      lines.push(
        `| ${sevIcon} | \`${escapeMarkdown(f.rule)}\` | \`${pkgName}\` | \`${version}\` | ${scope} | ${details} |`
      );
    }
    lines.push('');

    // Paths details
    const findingsWithPaths = findings.filter((f) => f.paths && f.paths.length > 0);
    if (findingsWithPaths.length > 0) {
      lines.push('### Dependency Paths & Fix Targets');
      lines.push('');
      for (const f of findingsWithPaths) {
        lines.push(`<details>`);
        lines.push(
          `<summary><strong>${escapeMarkdown(f.name)}@${escapeMarkdown(f.version)}</strong> (${escapeMarkdown(f.rule)})</summary>`
        );
        lines.push('');
        if (f.fixTargets && f.fixTargets.length > 0) {
          lines.push(
            `**Fix targets (direct dependencies):** ${f.fixTargets.map((ft) => `\`${escapeMarkdown(ft)}\``).join(', ')}`
          );
          lines.push('');
        }
        lines.push('Chains:');
        for (const p of f.paths) {
          lines.push(`- \`${p.map(escapeMarkdown).join(' > ')}\``);
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    }
  }

  // Licenses summary
  if (summary.licenses && Object.keys(summary.licenses).length > 0) {
    lines.push('### License Distribution');
    lines.push('');
    lines.push('| SPDX Identifier | Count |');
    lines.push('| :--- | :--- |');
    const sortedLicenses = Object.entries(summary.licenses).sort((a, b) => b[1] - a[1]);
    for (const [lic, count] of sortedLicenses) {
      lines.push(`| \`${escapeMarkdown(lic)}\` | ${count} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format report as human-readable plain or ANSI-colored terminal text.
 *
 * @param {object} report
 * @param {object} [options]
 * @param {boolean} [options.color=false]
 * @returns {string}
 */
export function formatText(report, options = {}) {
  const useColor = options.color ?? false;

  const red = (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
  const yellow = (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
  const cyan = (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s);
  const bold = (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

  const lines = [];
  const meta = report.meta || {};
  const summary = report.summary || {};
  const findings = report.findings || [];

  lines.push(bold(`lockvet — npm lockfile triage`));
  lines.push(
    dim(
      `Project: ${meta.projectName || 'root'} | Lockfile v${meta.lockfileVersion || '?'} | ${meta.packageCount || 0} packages`
    )
  );
  lines.push('');

  if (findings.length === 0) {
    lines.push('✔ No findings. Lockfile is clean.');
  } else {
    for (const f of findings) {
      let badge;
      if (f.severity === 'error') {
        badge = red('[ERROR]');
      } else if (f.severity === 'warning') {
        badge = yellow('[WARN] ');
      } else {
        badge = cyan('[INFO] ');
      }

      const scopeTag = dim(`(${f.scope || 'prod'})`);
      lines.push(`${badge} ${bold(f.name + '@' + f.version)} ${scopeTag} [${f.rule}]`);
      lines.push(`  ${sanitizeString(f.details)}`);

      if (f.fixTargets && f.fixTargets.length > 0) {
        lines.push(dim(`  Fix target: ${f.fixTargets.join(', ')}`));
      }

      if (f.paths && f.paths.length > 0) {
        for (const p of f.paths) {
          lines.push(dim(`  Chain: ${p.join(' -> ')}`));
        }
      }
      lines.push('');
    }
  }

  // Summary
  lines.push(bold('Summary:'));
  lines.push(`  Errors:   ${summary.errors || 0}`);
  lines.push(`  Warnings: ${summary.warnings || 0}`);
  lines.push(`  Info:     ${summary.info || 0}`);
  lines.push(`  Total:    ${summary.totalFindings || 0}`);

  if (summary.licenses && Object.keys(summary.licenses).length > 0) {
    lines.push('');
    lines.push(bold('Licenses:'));
    const sortedLicenses = Object.entries(summary.licenses).sort((a, b) => b[1] - a[1]);
    for (const [lic, count] of sortedLicenses) {
      lines.push(`  ${lic.padEnd(20)} ${count}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format report based on selected format.
 *
 * @param {object} report
 * @param {object} [options]
 * @param {'text' | 'json' | 'markdown'} [options.format='text']
 * @param {boolean} [options.color]
 * @returns {string}
 */
export function formatReport(report, options = {}) {
  const fmt = options.format || 'text';
  if (fmt === 'json') {
    return formatJson(report);
  }
  if (fmt === 'markdown') {
    return formatMarkdown(report);
  }
  return formatText(report, options);
}
