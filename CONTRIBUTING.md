# Contributing

Thanks for your interest in contributing to WheelDrop Logbook.

## Development Setup

```bash
git clone https://github.com/wheeldrop/logbook.git
cd logbook
npm install
```

## Running Checks

```bash
# Full test suite
npm test

# Coverage run (must meet threshold: 90% lines/functions/statements, 75% branches)
npm run test:coverage

# Mutation tests (Stryker)
npm run test:mutation

# Full check (lint + typecheck + coverage)
npm run check
```

## Code Style

- Pre-commit hooks run linting and tests automatically
- TypeScript strict mode is enabled
- All logging goes to stderr (`console.error`), never stdout (reserved for JSON-RPC)

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Ensure `npm run check` passes
5. Use conventional commits (for example: `feat:`, `fix:`, `docs:`)
6. Open a pull request with a clear summary

## Adding Features

- Add or update tests for behavioral changes
- Update `README.md` for user-facing changes
- Add release notes under `## [Unreleased]` in `CHANGELOG.md`

## Adding a New Agent Parser

1. Create `src/parsers/{agent}.ts` implementing the `AgentParser` interface from `src/parsers/types.ts`
2. Register it in `src/parsers/registry.ts`
3. Add tests following existing patterns in `src/parsers/*.test.ts`
4. Add test fixtures under `src/test-fixtures/`

## Reporting Bugs

Open an issue with:

- Node.js version
- Operating system
- Which AI coding agent is involved
- Minimal reproduction steps
- Expected behavior vs actual behavior

## Security Issues

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.
