import { sanitizeString } from './sanitize.js';

/**
 * Extract the package name from an npm lockfile install path.
 * e.g. "node_modules/foo" -> "foo"
 *      "node_modules/@scope/bar" -> "@scope/bar"
 *      "node_modules/a/node_modules/@scope/b" -> "@scope/b"
 *      "" -> root project name
 *
 * @param {string} installPath
 * @param {object} [entry]
 * @returns {string}
 */
export function derivePackageName(installPath, entry = null, fallbackName = 'root') {
  if (installPath === '') {
    return entry && typeof entry.name === 'string' && entry.name
      ? entry.name
      : fallbackName || 'root';
  }
  const nmIndex = installPath.lastIndexOf('node_modules/');
  if (nmIndex !== -1) {
    return installPath.slice(nmIndex + 'node_modules/'.length);
  }
  if (entry && typeof entry.name === 'string' && entry.name) {
    return entry.name;
  }
  // Fallback for custom workspace paths like "packages/my-pkg"
  const segments = installPath.split('/');
  return segments[segments.length - 1] || installPath;
}

/**
 * Resolve a dependency's install path using Node's hierarchical resolution.
 *
 * @param {Map<string, object>} packagesMap
 * @param {string} fromPath
 * @param {string} depName
 * @returns {string | null} Resolved install path in packagesMap or null
 */
export function resolveDependencyPath(packagesMap, fromPath, depName) {
  let current = fromPath;

  while (current !== null) {
    const candidate =
      current === '' ? `node_modules/${depName}` : `${current}/node_modules/${depName}`;
    if (packagesMap.has(candidate)) {
      const target = packagesMap.get(candidate);
      if (target && target.link === true && typeof target.resolved === 'string') {
        const resolvedKey = target.resolved.startsWith('./')
          ? target.resolved.slice(2)
          : target.resolved;
        if (packagesMap.has(resolvedKey)) {
          return resolvedKey;
        }
      }
      return candidate;
    }

    if (current === '') {
      current = null;
    } else {
      const lastNmIdx = current.lastIndexOf('/node_modules/');
      if (lastNmIdx !== -1) {
        current = current.slice(0, lastNmIdx);
      } else if (current.startsWith('node_modules/')) {
        current = '';
      } else {
        const lastSlash = current.lastIndexOf('/');
        current = lastSlash !== -1 ? current.slice(0, lastSlash) : '';
      }
    }
  }

  return null;
}

/**
 * Build a dependency graph from the parsed lockfile packages map.
 *
 * @param {object} lockfile Parsed lockfile
 * @returns {object} Graph structure with nodes, root, and warnings
 */
export function buildGraph(lockfile) {
  const rawPackages = lockfile.packages || {};
  const packagesMap = new Map();

  for (const [key, val] of Object.entries(rawPackages)) {
    if (val && typeof val === 'object') {
      packagesMap.set(key, val);
    }
  }

  const nodes = new Map();
  const missingDependencyWarnings = [];

  // Create node entries
  for (const [installPath, entry] of packagesMap.entries()) {
    const rawName = derivePackageName(installPath, entry, lockfile.name);
    const name = sanitizeString(rawName);
    const version = sanitizeString(
      typeof entry.version === 'string'
        ? entry.version
        : installPath === '' && lockfile.version
          ? lockfile.version
          : '0.0.0'
    );
    const isRoot = installPath === '';
    const isLink = entry.link === true;

    nodes.set(installPath, {
      installPath,
      name,
      version,
      id: `${name}@${version}`,
      entry,
      dependencies: new Set(),
      scope: 'prod', // Will be refined
      isRoot,
      isLink
    });
  }

  // Ensure root node exists even if "" wasn't in packages
  if (!nodes.has('')) {
    nodes.set('', {
      installPath: '',
      name: sanitizeString(lockfile.name || 'root'),
      version: sanitizeString(lockfile.version || '0.0.0'),
      id: `${sanitizeString(lockfile.name || 'root')}@${sanitizeString(lockfile.version || '0.0.0')}`,
      entry: {},
      dependencies: new Set(),
      scope: 'prod',
      isRoot: true,
      isLink: false
    });
  }

  // Wire dependency edges
  for (const [installPath, node] of nodes.entries()) {
    const entry = node.entry;
    if (!entry) continue;

    // Follow link targets for dependencies
    let depSource = entry;
    if (entry.link === true && entry.resolved) {
      const resolvedTarget = entry.resolved.startsWith('./')
        ? entry.resolved.slice(2)
        : entry.resolved;
      if (packagesMap.has(resolvedTarget)) {
        depSource = packagesMap.get(resolvedTarget);
      }
    }

    const regularDeps =
      depSource.dependencies && typeof depSource.dependencies === 'object'
        ? Object.keys(depSource.dependencies)
        : [];
    const devDeps =
      node.isRoot && depSource.devDependencies && typeof depSource.devDependencies === 'object'
        ? Object.keys(depSource.devDependencies)
        : [];
    const optionalDeps =
      depSource.optionalDependencies && typeof depSource.optionalDependencies === 'object'
        ? Object.keys(depSource.optionalDependencies)
        : [];
    const peerDeps =
      depSource.peerDependencies && typeof depSource.peerDependencies === 'object'
        ? Object.keys(depSource.peerDependencies)
        : [];

    const allDepNames = new Set([...regularDeps, ...devDeps, ...optionalDeps, ...peerDeps]);

    for (const depName of allDepNames) {
      const isOptionalOrPeer = optionalDeps.includes(depName) || peerDeps.includes(depName);
      const isDev = devDeps.includes(depName);
      const resolvedPath = resolveDependencyPath(packagesMap, installPath, depName);

      if (resolvedPath && nodes.has(resolvedPath)) {
        node.dependencies.add(resolvedPath);
      } else if (!isOptionalOrPeer && !isDev) {
        missingDependencyWarnings.push({
          type: 'missing-dependency',
          from: installPath || '(root)',
          dependency: depName,
          message: `Missing required dependency "${depName}" required by "${installPath || '(root)'}"`
        });
      }
    }
  }

  // Determine scopes (prod, dev, optional) via BFS from root
  const rootNode = nodes.get('');
  const visitedProd = new Set();
  const visitedDev = new Set();
  const visitedOptional = new Set();

  // 1. Prod traversal
  const rootEntry = rootNode.entry || {};
  const rootProdNames = new Set([
    ...Object.keys(rootEntry.dependencies || {}),
    ...Object.keys(rootEntry.peerDependencies || {})
  ]);
  const rootDevNames = new Set(Object.keys(rootEntry.devDependencies || {}));
  const rootOptNames = new Set(Object.keys(rootEntry.optionalDependencies || {}));

  // Resolve root direct deps
  const prodQueue = [];
  for (const depName of rootProdNames) {
    const resolved = resolveDependencyPath(packagesMap, '', depName);
    if (resolved && nodes.has(resolved)) {
      prodQueue.push(resolved);
      visitedProd.add(resolved);
    }
  }
  while (prodQueue.length > 0) {
    const currentPath = prodQueue.shift();
    const curr = nodes.get(currentPath);
    if (!curr) continue;
    for (const childPath of curr.dependencies) {
      if (!visitedProd.has(childPath)) {
        visitedProd.add(childPath);
        prodQueue.push(childPath);
      }
    }
  }

  // 2. Dev traversal
  const devQueue = [];
  for (const depName of rootDevNames) {
    const resolved = resolveDependencyPath(packagesMap, '', depName);
    if (resolved && nodes.has(resolved)) {
      devQueue.push(resolved);
      visitedDev.add(resolved);
    }
  }
  while (devQueue.length > 0) {
    const currentPath = devQueue.shift();
    const curr = nodes.get(currentPath);
    if (!curr) continue;
    for (const childPath of curr.dependencies) {
      if (!visitedDev.has(childPath)) {
        visitedDev.add(childPath);
        devQueue.push(childPath);
      }
    }
  }

  // 3. Optional traversal
  const optQueue = [];
  for (const depName of rootOptNames) {
    const resolved = resolveDependencyPath(packagesMap, '', depName);
    if (resolved && nodes.has(resolved)) {
      optQueue.push(resolved);
      visitedOptional.add(resolved);
    }
  }
  while (optQueue.length > 0) {
    const currentPath = optQueue.shift();
    const curr = nodes.get(currentPath);
    if (!curr) continue;
    for (const childPath of curr.dependencies) {
      if (!visitedOptional.has(childPath)) {
        visitedOptional.add(childPath);
        optQueue.push(childPath);
      }
    }
  }

  // Assign scope
  for (const [installPath, node] of nodes.entries()) {
    if (node.isRoot) {
      node.scope = 'prod';
      continue;
    }
    if (visitedProd.has(installPath)) {
      node.scope = 'prod';
    } else if (
      node.entry.dev === true ||
      (visitedDev.has(installPath) && !visitedProd.has(installPath))
    ) {
      node.scope = 'dev';
    } else if (node.entry.optional === true || visitedOptional.has(installPath)) {
      node.scope = 'optional';
    } else {
      node.scope = 'prod';
    }
  }

  return {
    nodes,
    root: rootNode,
    warnings: missingDependencyWarnings
  };
}

/**
 * BFS from root to compute up to N shortest dependency chains to target.
 * Chains are returned as arrays of "name@version".
 *
 * @param {object} graph
 * @param {string} target Identifier (package name, installPath, or name@version)
 * @param {object} [options]
 * @param {number} [options.max=3] Maximum number of shortest paths to return
 * @param {string} [options.version] Optional specific version filter
 * @returns {Array<string[]>} Array of chains
 */
export function findPaths(graph, target, options = {}) {
  const maxPaths = options.max ?? 3;
  if (maxPaths <= 0) return [];

  const rootNode = graph.root;
  if (!rootNode) return [];

  // Match target against node
  const matchesTarget = (node) => {
    if (node.isRoot) return false;
    if (options.version && node.version !== options.version) {
      return false;
    }
    if (node.installPath === target) return true;
    if (node.name === target) return true;
    if (node.id === target) return true;
    return false;
  };

  const results = [];
  // Queue entries: { path: [installPath...], chain: [name@version...], visited: Set<installPath> }
  const queue = [
    {
      path: [''],
      chain: [rootNode.id],
      visited: new Set([''])
    }
  ];

  const MAX_EXPANSIONS = 25000;
  let expansions = 0;

  while (queue.length > 0 && results.length < maxPaths) {
    if (++expansions > MAX_EXPANSIONS) {
      break; // Safeguard against massive graphs
    }

    const { path, chain, visited } = queue.shift();
    const currentPath = path[path.length - 1];
    const currentNode = graph.nodes.get(currentPath);
    if (!currentNode) continue;

    for (const childPath of currentNode.dependencies) {
      if (visited.has(childPath)) {
        continue; // Prevent circular cycles (A -> B -> A)
      }

      const childNode = graph.nodes.get(childPath);
      if (!childNode) continue;

      const nextChain = [...chain, childNode.id];
      if (matchesTarget(childNode)) {
        results.push(nextChain);
        if (results.length >= maxPaths) {
          return results;
        }
      }

      const nextVisited = new Set(visited);
      nextVisited.add(childPath);
      queue.push({
        path: [...path, childPath],
        chain: nextChain,
        visited: nextVisited
      });
    }
  }

  return results;
}
