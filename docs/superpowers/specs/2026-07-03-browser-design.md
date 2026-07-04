# Browser — Design Spec

**Date:** 2026-07-03  
**Scope:** `src/browser.ts` — Playwright session management for all scraper commands

---

## Overview

`browser.ts` owns the Playwright lifecycle for headless commands: launch, context creation with session injection, default page, and guaranteed teardown. It is the sole entry point for scraper commands to obtain a browser context.

Auth (`login()`) manages its own headed browser independently and does not use this module.

---

## API

```ts
withBrowser<T>(
  session: StorageState,
  fn: (handle: BrowserHandle) => Promise<T>
): Promise<T>

type BrowserHandle = {
  browser: Browser
  context: BrowserContext
  page: Page
}
```

`StorageState` is the type returned by `context.storageState()` — the same object persisted to `~/.mst/session.json` by `auth.ts`.

---

## Lifecycle

1. `chromium.launch({ headless: true })` — headless-only; headed mode is never needed here
2. `browser.newContext({ storageState: session })` — injects the saved auth cookies and localStorage
3. `context.setDefaultNavigationTimeout(30_000)` and `context.setDefaultTimeout(30_000)` — 30s default for all page operations
4. `context.newPage()` — one default page, ready to use
5. `fn({ browser, context, page })` — caller drives all navigation and interception
6. `finally: browser.close()` — always closes, even if `fn` throws; prevents zombie Chromium processes

---

## Responsibilities

**In scope:**
- Chromium launch (headless)
- Context creation with `storageState`
- Default timeout configuration
- Default page creation
- Guaranteed browser teardown

**Out of scope:**
- Session load / validation — `auth.ts` owns this; callers call `ensureValidSession()` before `withBrowser`
- Network interception — each scraper attaches its own `page.on('response', ...)` listeners inside `fn`
- Headed mode — `auth.ts` `login()` manages its own Playwright launch
- Error wrapping — Playwright errors propagate naturally; the CLI top-level handler catches them

---

## Usage pattern (in a scraper)

```ts
import { withBrowser } from './browser.js'
import { ensureValidSession } from './auth.js'

const session = await ensureValidSession()
const result = await withBrowser(session, async ({ page }) => {
  page.on('response', async (response) => {
    if (response.url().includes('/api/teams')) {
      const data = await response.json()
      // handle data
    }
  })
  await page.goto('https://teams.microsoft.com')
  // ...
  return result
})
```

---

## Error handling

- Playwright errors (navigation timeout, crash, etc.) propagate from `fn` to the caller unchanged
- `browser.close()` runs in `finally` regardless of success or failure
- No error wrapping or retries at this layer — the scraper or CLI handler decides how to handle failures
