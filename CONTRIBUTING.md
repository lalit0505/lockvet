# Contributing to lockvet

Contributions, issues and feature requests are welcome.

## Development Setup

1. Node.js >= 20 is required.
2. Install dev dependencies:
   npm install

## Tests & Linting

Before committing changes:

```bash
npm test
npm run lint
npm run format:check
```

## Design Principles

- Zero runtime dependencies.
- Strict ESM architecture.
- Deterministic and fully offline.
