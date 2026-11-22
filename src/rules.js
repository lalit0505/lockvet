import { sanitizeString } from './sanitize.js';
import { findPaths } from './graph.js';
import { evaluateLicense } from './spdx.js';

const REGISTRY_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'npm.pkg.github.com'
]);

/**
 * Check if a URL host belongs to a known or custom registry.
 * @param {string} host
 * @returns {boolean}
 */
function isRegistryHost(host) {
  if (REGISTRY_HOSTS.has(host)) return true;
  if (host.startsWith('registry.') || host.includes('.npm.pkg.github.com')) return true;
  return false;
}

/**
 * Run all triage rules on the built dependency graph.
 *
 * @param {object} graph
 * @param {object} options
 * @param {number} [options.maxPaths=3]
 * @param {boolean} [options.prodOnly=false]
 * @param {string[]} [options.denyLicenses=[]]
 * @param {string[]} [options.allowLicenses=[]]
 * @param {Array<string | { package: string }>} [options.ignore=[]]
 * @returns {object} { findings, ignoredFindings, licenseSummary }
 */
export function evaluateRules(graph, options = {}) {
  const maxPaths = options.maxPaths ?? 3;
  const prodOnly = options.prodOnly ?? false;

  // Build ignore set
  const ignorePkgNames = new Set();
  const ignorePkgVersions = new Set();
  if (Array.isArray(options.ignore)) {
    for (const item of options.ignore) {
      const raw =
        typeof item === 'string'
          ? item
          : item && typeof item.package === 'string'
            ? item.package
            : '';
      const str = raw.trim();
      if (!str) continue;
      if (
        (str.includes('@') && !str.startsWith('@')) ||
        (str.startsWith('@') && str.slice(1).includes('@'))
      ) {
        ignorePkgVersions.add(str);
      } else {
        ignorePkgNames.add(str);
      }
    }
  }

  const isIgnored = (name, version) => {
    if (ignorePkgNames.has(name)) return true;
    if (ignorePkgVersions.has(`${name}@${version}`)) return true;
    return false;
  };

  // Prepare license sets
  const deniedSet = new Set((options.denyLicenses || []).map((l) => l.trim().toUpperCase()));
  const allowedSet = new Set((options.allowLicenses || []).map((l) => l.trim().toUpperCase()));

  const allFindings = [];
  const licenseCounts = Object.create(null);

  // Group nodes by name for duplicates check
  const nodesByName = new Map();

  for (const [installPath, node] of graph.nodes.entries()) {
    if (node.isRoot) continue;

    // Filter prod-only if requested
    if (prodOnly && node.scope === 'dev') {
      continue;
    }

    // Tally licenses for summary table
    let rawLicense = node.entry.license;
    if (rawLicense && typeof rawLicense === 'object' && typeof rawLicense.type === 'string') {
      rawLicense = rawLicense.type;
    }
    const cleanLicense = sanitizeString(
      typeof rawLicense === 'string' && rawLicense.trim() ? rawLicense.trim() : 'UNKNOWN'
    );
    licenseCounts[cleanLicense] = (licenseCounts[cleanLicense] || 0) + 1;

    // License rule violation check
    if (deniedSet.size > 0 || allowedSet.size > 0) {
      const licenseResult = evaluateLicense(cleanLicense, allowedSet, deniedSet);
      if (licenseResult.denied || licenseResult.notAllowed) {
        const paths = findPaths(graph, installPath, { max: maxPaths });
        allFindings.push({
          rule: 'license',
          name: node.name,
          version: node.version,
          severity: 'error',
          details: sanitizeString(licenseResult.reason || 'License violation'),
          license: cleanLicense,
          paths,
          scope: node.scope
        });
      }
    }

    // Collect for duplicates check
    if (!node.isLink) {
      if (!nodesByName.has(node.name)) {
        nodesByName.set(node.name, []);
      }
      nodesByName.get(node.name).push(node);
    }

    // Rule 1: Deprecated
    if (typeof node.entry.deprecated === 'string' && node.entry.deprecated.trim().length > 0) {
      const paths = findPaths(graph, installPath, { max: maxPaths });
      const fixTargets = Array.from(
        new Set(paths.map((p) => (p.length > 1 ? p[1] : p[0])).filter(Boolean))
      );
      const severity = node.scope === 'dev' ? 'info' : 'warning';
      allFindings.push({
        rule: 'deprecated',
        name: node.name,
        version: node.version,
        severity,
        details: sanitizeString(node.entry.deprecated),
        paths,
        fixTargets,
        scope: node.scope
      });
    }

    // Rule 2: Install scripts
    if (node.entry.hasInstallScript === true) {
      const paths = findPaths(graph, installPath, { max: maxPaths });
      allFindings.push({
        rule: 'install-scripts',
        name: node.name,
        version: node.version,
        severity: 'info',
        details: 'Package contains an install script (preinstall, install, or postinstall)',
        paths,
        scope: node.scope
      });
    }

    // Rule 3: Source verification
    if (!node.isLink) {
      const resolved = typeof node.entry.resolved === 'string' ? node.entry.resolved.trim() : '';
      if (!resolved) {
        const paths = findPaths(graph, installPath, { max: maxPaths });
        allFindings.push({
          rule: 'source',
          name: node.name,
          version: node.version,
          severity: 'warning',
          details: 'Package is missing a resolved URL',
          paths,
          scope: node.scope
        });
      } else if (!resolved.startsWith('https://')) {
        const paths = findPaths(graph, installPath, { max: maxPaths });
        allFindings.push({
          rule: 'source',
          name: node.name,
          version: node.version,
          severity: 'warning',
          details: `Non-HTTPS or non-registry source URL: ${sanitizeString(resolved)}`,
          paths,
          scope: node.scope
        });
      } else {
        // Starts with https:// - check host and integrity
        let urlHost = '';
        try {
          const parsedUrl = new URL(resolved);
          urlHost = parsedUrl.hostname;
        } catch {
          urlHost = '';
        }

        if (urlHost && !isRegistryHost(urlHost)) {
          const paths = findPaths(graph, installPath, { max: maxPaths });
          allFindings.push({
            rule: 'source',
            name: node.name,
            version: node.version,
            severity: 'info',
            details: `Package downloaded from non-registry host over HTTPS: ${sanitizeString(urlHost)}`,
            paths,
            scope: node.scope
          });
        } else {
          // It is a registry package
          if (!node.entry.integrity || typeof node.entry.integrity !== 'string') {
            const paths = findPaths(graph, installPath, { max: maxPaths });
            allFindings.push({
              rule: 'source',
              name: node.name,
              version: node.version,
              severity: 'warning',
              details: 'Missing integrity checksum for registry package',
              paths,
              scope: node.scope
            });
          }
        }
      }
    }
  }

  // Rule 4: Duplicates (2+ different versions of the same package)
  for (const [pkgName, nodeList] of nodesByName.entries()) {
    const versionMap = new Map();
    for (const n of nodeList) {
      if (!versionMap.has(n.version)) {
        versionMap.set(n.version, n);
      }
    }

    if (versionMap.size >= 2) {
      const versions = Array.from(versionMap.keys()).sort();
      const versionChains = Object.create(null);
      const paths = [];

      for (const ver of versions) {
        const node = versionMap.get(ver);
        const chain = findPaths(graph, node.installPath, { max: 1 })[0] || [node.id];
        versionChains[ver] = chain;
        paths.push(chain);
      }

      // Overall scope: if any version is in prod, prod; else if any optional, optional; else dev
      const scopes = nodeList.map((n) => n.scope);
      const overallScope = scopes.includes('prod')
        ? 'prod'
        : scopes.includes('optional')
          ? 'optional'
          : 'dev';

      allFindings.push({
        rule: 'duplicates',
        name: pkgName,
        version: versions.join(', '),
        severity: 'info',
        details: `Installed in ${versions.length} distinct versions: ${versions.join(', ')}`,
        versions,
        versionChains,
        paths,
        scope: overallScope
      });
    }
  }

  // Separate ignored vs active findings
  const findings = [];
  const ignoredFindings = [];

  for (const f of allFindings) {
    if (isIgnored(f.name, f.version)) {
      ignoredFindings.push(f);
    } else {
      findings.push(f);
    }
  }

  return {
    findings,
    ignoredFindings,
    licenseSummary: licenseCounts
  };
}
