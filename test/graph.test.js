import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, findPaths } from '../src/graph.js';

test('graph resolution resolves nested node_modules and walks up hierarchy', () => {
  const lockfile = {
    name: 'test-app',
    version: '1.0.0',
    lockfileVersion: 2,
    packages: {
      '': {
        name: 'test-app',
        dependencies: { a: '^1.0.0' }
      },
      'node_modules/a': {
        version: '1.0.0',
        dependencies: { b: '^2.0.0', c: '^3.0.0' }
      },
      'node_modules/a/node_modules/b': {
        version: '2.0.0',
        dependencies: {}
      },
      'node_modules/c': {
        version: '3.0.0',
        dependencies: {}
      }
    }
  };

  const graph = buildGraph(lockfile);
  assert.equal(graph.nodes.size, 4);

  // 'a' depends on local 'b' and hoisted 'c'
  const nodeA = graph.nodes.get('node_modules/a');
  assert.ok(nodeA.dependencies.has('node_modules/a/node_modules/b'));
  assert.ok(nodeA.dependencies.has('node_modules/c'));
});

test('graph handles scoped packages properly', () => {
  const lockfile = {
    name: 'scoped-app',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@my-scope/pkg-a': '1.0.0' } },
      'node_modules/@my-scope/pkg-a': {
        version: '1.0.0',
        dependencies: { '@my-scope/pkg-b': '2.0.0' }
      },
      'node_modules/@my-scope/pkg-b': {
        version: '2.0.0'
      }
    }
  };

  const graph = buildGraph(lockfile);
  const pkgA = graph.nodes.get('node_modules/@my-scope/pkg-a');
  assert.equal(pkgA.name, '@my-scope/pkg-a');

  const paths = findPaths(graph, '@my-scope/pkg-b', { max: 3 });
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0], [
    'scoped-app@0.0.0',
    '@my-scope/pkg-a@1.0.0',
    '@my-scope/pkg-b@2.0.0'
  ]);
});

test('graph handles workspace links with link: true', () => {
  const lockfile = {
    name: 'mono',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { 'workspace-pkg': '*' } },
      'node_modules/workspace-pkg': {
        resolved: 'packages/workspace-pkg',
        link: true
      },
      'packages/workspace-pkg': {
        name: 'workspace-pkg',
        version: '1.0.0',
        dependencies: { 'shared-util': '1.0.0' }
      },
      'node_modules/shared-util': {
        version: '1.0.0'
      }
    }
  };

  const graph = buildGraph(lockfile);
  const paths = findPaths(graph, 'shared-util', { max: 2 });
  assert.equal(paths.length, 1);
  assert.equal(paths[0][paths[0].length - 1], 'shared-util@1.0.0');
});

test('graph handles __proto__ and constructor package names safely', () => {
  const lockfile = {
    name: 'safety-check',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: {
          ['__proto__']: '1.0.0',
          ['constructor']: '1.0.0'
        }
      },
      'node_modules/__proto__': {
        version: '1.0.0'
      },
      'node_modules/constructor': {
        version: '1.0.0'
      }
    }
  };

  const graph = buildGraph(lockfile);
  assert.ok(graph.nodes.has('node_modules/__proto__'));
  assert.ok(graph.nodes.has('node_modules/constructor'));

  const pathsProto = findPaths(graph, '__proto__');
  assert.equal(pathsProto.length, 1);

  const pathsCtor = findPaths(graph, 'constructor');
  assert.equal(pathsCtor.length, 1);
});

test('graph handles circular dependencies without infinite loops', () => {
  const lockfile = {
    name: 'circular-app',
    lockfileVersion: 2,
    packages: {
      '': { dependencies: { a: '1.0.0' } },
      'node_modules/a': {
        version: '1.0.0',
        dependencies: { b: '1.0.0' }
      },
      'node_modules/b': {
        version: '1.0.0',
        dependencies: { a: '1.0.0' }
      }
    }
  };

  const graph = buildGraph(lockfile);
  const paths = findPaths(graph, 'b', { max: 3 });
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0], ['circular-app@0.0.0', 'a@1.0.0', 'b@1.0.0']);
});

test('shortest path and fix target correctness with multiple paths', () => {
  // Target 'leaf' reachable via:
  // Path 1 (length 3 edges): root -> directShort -> leaf
  // Path 2 (length 4 edges): root -> directLong -> mid -> leaf
  const lockfile = {
    name: 'multi-path',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: {
          directShort: '1.0.0',
          directLong: '1.0.0'
        }
      },
      'node_modules/directShort': {
        version: '1.0.0',
        dependencies: { leaf: '1.0.0' }
      },
      'node_modules/directLong': {
        version: '1.0.0',
        dependencies: { mid: '1.0.0' }
      },
      'node_modules/mid': {
        version: '1.0.0',
        dependencies: { leaf: '1.0.0' }
      },
      'node_modules/leaf': {
        version: '1.0.0'
      }
    }
  };

  const graph = buildGraph(lockfile);
  const paths = findPaths(graph, 'leaf', { max: 2 });
  assert.equal(paths.length, 2);

  // Shortest path must be first
  assert.equal(paths[0].length, 3);
  assert.deepEqual(paths[0], ['multi-path@0.0.0', 'directShort@1.0.0', 'leaf@1.0.0']);
  assert.equal(paths[0][1], 'directShort@1.0.0'); // Fix target

  // Second path
  assert.equal(paths[1].length, 4);
  assert.deepEqual(paths[1], ['multi-path@0.0.0', 'directLong@1.0.0', 'mid@1.0.0', 'leaf@1.0.0']);
  assert.equal(paths[1][1], 'directLong@1.0.0'); // Fix target
});

test('handles missing required dependencies with non-fatal warning, optional silently', () => {
  const lockfile = {
    name: 'missing-check',
    lockfileVersion: 2,
    packages: {
      '': {
        dependencies: { requiredMissing: '^1.0.0' },
        optionalDependencies: { optionalMissing: '^1.0.0' },
        peerDependencies: { peerMissing: '^1.0.0' }
      }
    }
  };

  const graph = buildGraph(lockfile);
  assert.equal(graph.warnings.length, 1);
  assert.equal(graph.warnings[0].dependency, 'requiredMissing');
});
