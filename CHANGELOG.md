# Changelog

All notable changes to `lockvet` will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [1.0.0] - 2026-11-22

### Added

- Initial release of `lockvet` offline npm lockfile inspector and triaging tool.
- Support for npm lockfileVersion 2 and 3 with full node resolution algorithm.
- Deprecation rule with production vs development scope and direct dependency fix target derivation.
- Install script detection rule for preinstall, install, and postinstall hooks.
- Source validation rule for HTTPS registries, integrity hashes, and untrusted sources.
- Package version duplicate detection with dependency path reporting.
- SPDX license policy validation with `--allow-license` and `--deny-license` supporting boolean logic.
- Text, Markdown, and JSON output formats with stable schema version 1.
- CLI supporting `.lockvetrc.json` configuration, configurable exit codes, and no-color terminal output.
