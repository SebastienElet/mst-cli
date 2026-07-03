# Lint & Format Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add oxlint + oxfmt with a husky/lint-staged pre-commit gate and CI enforcement so every commit and every CI run is format- and lint-clean.

**Architecture:** oxfmt formats staged `.ts` files in-place; oxlint lints them. A husky v9 pre-commit hook runs both via lint-staged, scoped to staged files only. CI runs `format:check` and `lint` before `build` and `test`.

**Tech Stack:** oxlint 1.72.0, oxfmt 0.57.0, husky 9.1.7, lint-staged 17.0.8

## Global Constraints

- All deps pinned to exact versions — no `^` ranges. Use `--save-exact` flag.
- Package manager: `pnpm` — never `npm install`.
- Node 24.18.0 / pnpm 11.9.0.
- Source files: `src/` (4 `.ts` files) and `tests/` (1 `.ts` file).

---

### Task 1: Install packages and update package.json

**Files:**
- Modify: `package.json`
- Auto-updated: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `pnpm lint`, `pnpm format`, `pnpm format:check` CLI scripts; `prepare` lifecycle hook; `lint-staged` config used by Task 3.

- [ ] **Step 1: Install devDependencies with exact pinning**

```bash
pnpm add -D --save-exact oxlint@1.72.0 oxfmt@0.57.0 husky@9.1.7 lint-staged@17.0.8
```

Expected: command exits 0; `devDependencies` in `package.json` now contains all four packages with no `^` prefix.

- [ ] **Step 2: Add scripts and lint-staged config to package.json**

The full `scripts` block should be:

```json
"scripts": {
  "build": "tsc -p tsconfig.build.json",
  "dev": "tsx src/cli.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "prepare": "husky",
  "lint": "oxlint src tests",
  "format": "oxfmt src tests",
  "format:check": "oxfmt --check src tests"
}
```

Add a top-level `"lint-staged"` key (not inside `scripts`):

```json
"lint-staged": {
  "**/*.ts": ["oxfmt", "oxlint"]
}
```

`**/*.ts` matches staged `.ts` files in any subdirectory. `oxfmt` (no flags) writes in-place; lint-staged automatically re-stages modified files before the commit lands.

- [ ] **Step 3: Verify scripts are runnable**

```bash
pnpm lint --help
```

Expected: oxlint prints its help text and exits 0.

```bash
pnpm format:check
```

Expected: exits 0 or prints formatting diffs — either is fine at this stage. The goal is confirming oxfmt resolves correctly.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install oxlint, oxfmt, husky, lint-staged"
```

---

### Task 2: Configure oxlint

**Files:**
- Create: `.oxlintrc.json`

**Interfaces:**
- Consumes: `oxlint` binary from Task 1.
- Produces: `.oxlintrc.json` read by `pnpm lint` and by lint-staged in Task 3.

- [ ] **Step 1: Create `.oxlintrc.json`**

```json
{
  "plugins": ["typescript"],
  "categories": {
    "correctness": "error",
    "suspicious": "warn",
    "pedantic": "warn"
  }
}
```

`correctness` → error (definite bugs), `suspicious`/`pedantic` → warn (possible issues, occasional false positives). `restriction` is omitted (off by default — too opinionated). The `typescript` plugin adds TS-specific rules (unused vars, no-explicit-any, etc.).

- [ ] **Step 2: Run lint and fix any reported issues**

```bash
pnpm lint
```

Expected: prints warnings/errors against `src/` and `tests/`. Fix any `error`-severity findings before continuing. Warnings can stay — they won't block commits.

- [ ] **Step 3: Commit**

```bash
git add .oxlintrc.json
# Include any src/tests files fixed in step 2:
git add src/ tests/
git commit -m "chore: add oxlint config with correctness/suspicious/pedantic rules"
```

---

### Task 3: Set up husky pre-commit hook

**Files:**
- Create: `.husky/pre-commit`

**Interfaces:**
- Consumes: `lint-staged` config from Task 1, `oxfmt` and `oxlint` from Task 1.
- Produces: git pre-commit hook that blocks commits with format/lint errors.

- [ ] **Step 1: Initialize husky**

```bash
pnpm prepare
```

This runs the `prepare: husky` script added in Task 1. Husky registers `.husky/` as the git hooks directory. Expected: exits 0. A `.husky/` directory is created if it didn't exist.

Note: in CI, `CI=true` is set by GitHub Actions — husky v9 detects this and exits 0 (no-op), so `pnpm install --frozen-lockfile` in CI is safe.

- [ ] **Step 2: Create the pre-commit hook**

```bash
printf 'pnpm exec lint-staged\n' > .husky/pre-commit
chmod +x .husky/pre-commit
```

- [ ] **Step 3: Verify the hook runs**

Stage any source file and make a commit:

```bash
git add src/cli.ts
git commit -m "test: verify pre-commit hook fires"
```

Expected: you see lint-staged output (oxfmt + oxlint running), then the commit succeeds.

To verify the hook **blocks** bad commits, temporarily add `const x = 1` (unused var) to `src/cli.ts`, stage it, and attempt a commit. Expected: lint-staged runs oxlint, which exits non-zero, and git aborts the commit. Revert the change afterwards.

- [ ] **Step 4: Commit the hook**

```bash
git add .husky/pre-commit
git commit -m "chore: add husky pre-commit hook running lint-staged"
```

---

### Task 4: Add lint + format:check to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm format:check`, `pnpm lint` from Task 1.

- [ ] **Step 1: Update `.github/workflows/ci.yml`**

Replace the full file content with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.9.0

      - uses: actions/setup-node@v4
        with:
          node-version: 24.18.0
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm format:check

      - run: pnpm lint

      - run: pnpm build

      - run: pnpm test
```

`format:check` and `lint` run before `build` and `test` — cheap to compute, surface failures early.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add format:check and lint steps"
```
