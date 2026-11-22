# lockvet

Fast, zero-dependency, offline npm lockfile inspector and supply-chain hygiene triager.

## Features

- Zero runtime dependencies (Node >= 20 native ESM).
- 100% offline and deterministic.
- Supports npm lockfileVersion 2 and 3.
- Full dependency tree resolution and shortest path reporting to direct targets.
- 5 audit rules: deprecated, install-scripts, source, duplicates, licenses.
- Output formats: text, markdown, json.
- Custom rules configuration via .lockvetrc.json.

## Installation

```bash
npm install -g lockvet
```

Or run directly:

```bash
npx lockvet
```

## Usage

```bash
# Check current directory lockfile
lockvet

# Check custom lockfile
lockvet path/to/package-lock.json

# Fail on warnings or errors
lockvet --fail-on warning

# Output as Markdown
lockvet --format markdown

# License enforcement
lockvet --deny-license "GPL-3.0, AGPL-3.0"
```

## CLI Flags

- `-f, --format <text|markdown|json>`: Output format (default: text)
- `--fail-on <level|rule>`: Exit with code 1 if matching issues are found
- `--prod-only`: Evaluate production dependencies only
- `--ignore <packages>`: Comma-separated package names or name@version to ignore
- `--deny-license <list>`: Comma-separated list of denied SPDX identifiers
- `--allow-license <list>`: Comma-separated list of allowed SPDX identifiers
- `--max-paths <number>`: Max dependency paths per issue (default: 3)
- `--no-color`: Disable color output
- `-v, --version`: Display version
- `-h, --help`: Display help

## Configuration (.lockvetrc.json)

```json
{
  "prodOnly": false,
  "format": "text",
  "failOn": "error",
  "maxPaths": 3,
  "ignore": [],
  "rules": {
    "deprecated": { "enabled": true },
    "install-scripts": { "enabled": true },
    "source": { "enabled": true },
    "duplicates": { "enabled": true },
    "licenses": {
      "enabled": true,
      "allow": ["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause"],
      "deny": []
    }
  }
}
```

## Programmatic API

```javascript
import { analyze, parseLockfile, formatReport } from 'lockvet';
import { readFileSync } from 'node:fs';

const lockfile = parseLockfile(readFileSync('./package-lock.json', 'utf8'));
const report = analyze(lockfile, { prodOnly: true });
console.log(formatReport(report, 'text'));
```

## License

MIT (c) 2026 Lalit Mittal
