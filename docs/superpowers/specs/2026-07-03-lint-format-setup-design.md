# Lint & Format Setup — Design Spec

**Date:** 2026-07-03  
**Status:** Approved

## Goal

Add fast, zero-config linting and formatting to mst-cli using the Oxc ecosystem, with a pre-commit gate via husky + lint-staged and CI enforcement via GitHub Actions.

## Toolchain

| Tool | Role | Notes |
|------|------|-------|
| `oxlint` | Linter | Rust-based, fast, TS-aware |
| `oxfmt` | Formatter | Rust-based, Oxc ecosystem |
| `husky` | Git hook manager | v9, `prepare` script |
| `lint-staged` | Scope hooks to staged files | Runs oxfmt then oxlint |

All packages pinned to exact latest versions per project convention.

## Linter Config (`.oxlintrc.json`)

Enable three rule categories:

- **correctness** — bugs that are definitely wrong
- **suspicious** — code that is likely a bug
- **pedantic** — stricter style/correctness checks

Disable:

- **restriction** — too opinionated, generates noise

Enable the `@typescript-eslint` plugin for TS-specific rules:
- `no-unused-vars`, `no-explicit-any`, `no-require-imports`

## Formatter (oxfmt)

No config file. Defaults apply:
- 2-space indentation
- Single quotes
- Trailing commas where valid in ES5

## Pre-commit Gate

`husky` v9 initialised via `prepare` script — hooks install automatically on `pnpm install`.

`.husky/pre-commit` runs `lint-staged`.

`lint-staged` config (in `package.json` under `"lint-staged"` key):

```json
{
  "**/*.ts": ["oxfmt", "oxlint"]
}
```

Steps in order:
1. `oxfmt --write` — formats staged `.ts` files in-place
2. `oxlint` — lints; exits non-zero on any error, blocking the commit

## package.json Scripts

```json
{
  "prepare": "husky",
  "lint": "oxlint src tests",
  "format": "oxfmt src tests",
  "format:check": "oxfmt --check src tests"
}
```

## CI (GitHub Actions)

Two steps inserted after `pnpm install`, before `build` and `test`:

```yaml
- run: pnpm format:check
- run: pnpm lint
```

Ordering rationale: format and lint failures are cheap to report and should surface before the heavier build/test steps.

## Out of Scope

- Auto-fix in CI (read-only check only)
- `commit-msg` hook for commit message linting
- Additional husky hooks (pre-push, etc.)
