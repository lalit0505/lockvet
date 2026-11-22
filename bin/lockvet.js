#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { analyze, formatReport, LockvetError } from '../src/index.js';

const HELP_TEXT = `
lockvet [path] [options]

Offline npm lockfile hygiene and supply chain triaging CLI.

Arguments:
  path                    Path to package-lock.json or npm-shrinkwrap.json
                          (default: ./package-lock.json, then ./npm-shrinkwrap.json)

Options:
  --format <fmt>          Output format: text, json, markdown (default: text)
  --fail-on <rules>       Comma-separated list of rules that exit with code 1 if violated:
                          deprecated, install-scripts, source, duplicates, license, none (default: none)
  --ignore <pkg>          Ignore findings for package name or name@version (repeatable)
  --max-paths <N>         Maximum shortest paths to display per finding (default: 3)
  --prod-only             Only inspect production dependencies
  --deny-license <ID>     Deny specified SPDX license identifier (repeatable)
  --allow-license <ID>    Allow only specified SPDX license identifiers (repeatable)
  --no-color              Disable colored terminal output
  -v, --version           Show version number
  -h, --help              Show help message

Exit Codes:
  0                       Clean analysis / no fail-on rules triggered
  1                       One or more --fail-on rules triggered findings
  2                       Command usage, file access, or parsing error
`;

function parseArgs(argv) {
  const options = {
    targetPath: null,
    format: 'text',
    failOn: null,
    ignore: [],
    maxPaths: 3,
    prodOnly: false,
    denyLicense: [],
    allowLicense: [],
    noColor: false,
    help: false,
    version: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '--no-color') {
      options.noColor = true;
    } else if (arg === '--prod-only') {
      options.prodOnly = true;
    } else if (arg === '--format' || arg.startsWith('--format=')) {
      const val = arg.startsWith('--format=') ? arg.slice('--format='.length) : argv[++i];
      if (!val || !['text', 'json', 'markdown'].includes(val)) {
        throw new LockvetError(
          `Invalid --format: "${val}". Must be one of text, json, markdown.`,
          'ERR_INVALID_USAGE'
        );
      }
      options.format = val;
    } else if (arg === '--fail-on' || arg.startsWith('--fail-on=')) {
      const val = arg.startsWith('--fail-on=') ? arg.slice('--fail-on='.length) : argv[++i];
      options.failOn = val;
    } else if (arg === '--ignore' || arg.startsWith('--ignore=')) {
      const val = arg.startsWith('--ignore=') ? arg.slice('--ignore='.length) : argv[++i];
      if (val) options.ignore.push(val);
    } else if (arg === '--deny-license' || arg.startsWith('--deny-license=')) {
      const val = arg.startsWith('--deny-license=')
        ? arg.slice('--deny-license='.length)
        : argv[++i];
      if (val) options.denyLicense.push(val);
    } else if (arg === '--allow-license' || arg.startsWith('--allow-license=')) {
      const val = arg.startsWith('--allow-license=')
        ? arg.slice('--allow-license='.length)
        : argv[++i];
      if (val) options.allowLicense.push(val);
    } else if (arg === '--max-paths' || arg.startsWith('--max-paths=')) {
      const val = arg.startsWith('--max-paths=') ? arg.slice('--max-paths='.length) : argv[++i];
      const parsed = parseInt(val, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new LockvetError(
          `Invalid --max-paths: "${val}". Must be a non-negative integer.`,
          'ERR_INVALID_USAGE'
        );
      }
      options.maxPaths = parsed;
    } else if (arg.startsWith('-')) {
      throw new LockvetError(
        `Unknown option: "${arg}". Use --help for usage.`,
        'ERR_INVALID_USAGE'
      );
    } else if (!options.targetPath) {
      options.targetPath = arg;
    } else {
      throw new LockvetError(`Unexpected positional argument: "${arg}"`, 'ERR_INVALID_USAGE');
    }
  }

  return options;
}

function loadConfig(dir) {
  const configPath = path.join(dir, '.lockvetrc.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  let content;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new LockvetError(
      `Failed to read config file at ${configPath}: ${err.message}`,
      'ERR_CONFIG_READ'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new LockvetError(
      `Invalid JSON in configuration file ${configPath}: ${err.message}`,
      'ERR_CONFIG_INVALID'
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LockvetError(
      `Configuration file ${configPath} must be a JSON object`,
      'ERR_CONFIG_INVALID'
    );
  }

  if (parsed.ignore !== undefined && !Array.isArray(parsed.ignore)) {
    throw new LockvetError(
      `"ignore" field in ${configPath} must be an array`,
      'ERR_CONFIG_INVALID'
    );
  }

  if (
    parsed.failOn !== undefined &&
    !Array.isArray(parsed.failOn) &&
    typeof parsed.failOn !== 'string'
  ) {
    throw new LockvetError(
      `"failOn" field in ${configPath} must be an array or string`,
      'ERR_CONFIG_INVALID'
    );
  }

  return parsed;
}

function resolveLockfilePath(targetPath) {
  if (targetPath) {
    const resolved = path.resolve(process.cwd(), targetPath);
    if (!fs.existsSync(resolved)) {
      throw new LockvetError(`Lockfile not found at ${resolved}`, 'ERR_FILE_NOT_FOUND');
    }
    return resolved;
  }

  const defaultLock = path.resolve(process.cwd(), 'package-lock.json');
  if (fs.existsSync(defaultLock)) {
    return defaultLock;
  }

  const shrinkwrap = path.resolve(process.cwd(), 'npm-shrinkwrap.json');
  if (fs.existsSync(shrinkwrap)) {
    return shrinkwrap;
  }

  throw new LockvetError(
    'No lockfile found. Looked for package-lock.json and npm-shrinkwrap.json in current directory.',
    'ERR_FILE_NOT_FOUND'
  );
}

function getPackageVersion() {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const content = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

async function main() {
  let cliOpts;
  try {
    cliOpts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  if (cliOpts.help) {
    process.stdout.write(HELP_TEXT.trim() + '\n');
    process.exit(0);
  }

  if (cliOpts.version) {
    process.stdout.write(`v${getPackageVersion()}\n`);
    process.exit(0);
  }

  let lockfilePath;
  try {
    lockfilePath = resolveLockfilePath(cliOpts.targetPath);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  // Load config from lockfile directory
  let config = null;
  try {
    config = loadConfig(path.dirname(lockfilePath));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  // Merge options: CLI flags override config
  const ignore = [...(config?.ignore || []), ...cliOpts.ignore];
  const denyLicenses = [
    ...(config?.denyLicenses || config?.denyLicense || []),
    ...cliOpts.denyLicense
  ];
  const allowLicenses = [
    ...(config?.allowLicenses || config?.allowLicense || []),
    ...cliOpts.allowLicense
  ];
  const prodOnly = cliOpts.prodOnly || Boolean(config?.prodOnly);
  const maxPaths = cliOpts.maxPaths ?? config?.maxPaths ?? 3;

  // Determine fail-on rules
  let rawFailOn = cliOpts.failOn;
  if (rawFailOn === null && config && config.failOn) {
    rawFailOn = Array.isArray(config.failOn) ? config.failOn.join(',') : config.failOn;
  }
  if (!rawFailOn) {
    rawFailOn = 'none';
  }

  const validRules = new Set([
    'deprecated',
    'install-scripts',
    'source',
    'duplicates',
    'license',
    'licenses',
    'none'
  ]);
  const failOnRules = new Set(
    rawFailOn
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  for (const r of failOnRules) {
    if (!validRules.has(r)) {
      process.stderr.write(
        `error: unknown rule "${r}" specified in --fail-on. Valid rules are: deprecated, install-scripts, source, duplicates, license, none\n`
      );
      process.exit(2);
    }
  }

  let lockfileContent;
  try {
    lockfileContent = fs.readFileSync(lockfilePath, 'utf8');
  } catch (err) {
    process.stderr.write(`error: Failed to read lockfile: ${err.message}\n`);
    process.exit(2);
  }

  let report;
  try {
    report = analyze(lockfileContent, {
      maxPaths,
      prodOnly,
      denyLicenses,
      allowLicenses,
      ignore
    });
  } catch (err) {
    if (process.env.DEBUG === 'lockvet' && err.stack) {
      process.stderr.write(err.stack + '\n');
    } else {
      process.stderr.write(`error: ${err.message}\n`);
    }
    process.exit(2);
  }

  const useColor =
    !cliOpts.noColor && process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);
  const formatted = formatReport(report, {
    format: cliOpts.format,
    color: useColor
  });

  process.stdout.write(formatted + '\n');

  // Check fail-on conditions
  if (!failOnRules.has('none')) {
    const failedFindings = report.findings.filter((f) => {
      if (failOnRules.has(f.rule)) return true;
      if (f.rule === 'license' && failOnRules.has('licenses')) return true;
      return false;
    });

    if (failedFindings.length > 0) {
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  if (process.env.DEBUG === 'lockvet' && err.stack) {
    process.stderr.write(err.stack + '\n');
  } else {
    process.stderr.write(`error: ${err.message}\n`);
  }
  process.exit(2);
});
