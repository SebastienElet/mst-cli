# Auth — Design Spec

**Date:** 2026-07-03  
**Scope:** `mst auth login`, `mst auth status`, session persistence and expiry detection

---

## Overview

The auth module owns the full session lifecycle: saving, loading, validating, and reporting on the Playwright `storageState` stored at `~/.mst/session.json`. All other commands depend on it via `ensureValidSession()` before launching any browser work.

---

## Module: `src/auth.ts`

Sole owner of:
- Session file path (`~/.mst/session.json`)
- Session save/load/validation logic
- Typed errors: `SessionNotFoundError`, `SessionExpiredError`

`src/browser.ts` handles only Playwright mechanics (launch, context creation, teardown). It does not know about expiry or session file paths.

---

## Functions

### `login(): Promise<void>`

1. Launch headed (non-headless) Chromium — required because:
   - The user must visually interact with Microsoft SSO (credentials, MFA, org redirects)
   - `login.microsoftonline.com` detects headless Chromium via JS fingerprinting and blocks or challenges it
2. Navigate to `https://teams.microsoft.com`
3. Wait for the page URL to stop matching `login.microsoftonline.com` — signals that the Teams app has fully loaded post-login
4. Call `context.storageState()` and write result to `~/.mst/session.json`
   - Create `~/.mst/` if absent, with mode `0700`
5. Close browser
6. Print confirmation to stderr: `Session saved to ~/.mst/session.json`

If the user closes the browser before completing login, exit with:
```
Login cancelled — browser closed before authentication completed.
```
Exit code `1`.

---

### `loadSession(): StorageState`

- Reads and parses `~/.mst/session.json`
- Throws `SessionNotFoundError` if the file does not exist

---

### `isSessionValid(state: StorageState): { valid: boolean; expiresAt: Date | null }`

Inspects the storageState without launching a browser:

1. Looks for known Microsoft auth cookies: `ESTSAUTH`, `ESTSAUTHPERSISTENT`
2. For each required cookie, checks the `expires` field (Unix timestamp) against `Date.now()`
3. Returns `{ valid: false, expiresAt: null }` if any required cookie is missing
4. Returns `{ valid: false, expiresAt }` if any required cookie is expired
5. Returns `{ valid: true, expiresAt }` where `expiresAt` is the earliest expiry among required cookies

---

### `ensureValidSession(): StorageState`

Called at the top of every command handler before any Playwright context is created:

1. Calls `loadSession()` — throws `SessionNotFoundError` on missing file
2. Calls `isSessionValid()` — throws `SessionExpiredError` if invalid
3. Returns the `StorageState` for use by `browser.ts`

The CLI top-level error handler catches both error types and prints:
```
Session expired or not found. Run: mst auth login
```
Then exits with code `1`.

---

### `status(): { valid: boolean; expiresAt: string | null }`

Calls `loadSession` + `isSessionValid`. Returns structured data for the `mst auth status` command. Does not throw — returns `{ valid: false, expiresAt: null }` on any error (file not found, parse failure).

---

## Commands

### `mst auth login`

Calls `login()`. The only command that runs a headed browser.

### `mst auth status`

Calls `status()`. Outputs the standard JSON envelope to stdout:

```json
{
  "success": true,
  "data": {
    "valid": true,
    "expiresAt": "2026-07-03T18:00:00Z"
  },
  "metadata": { "timestamp": "...", "duration_ms": 12 }
}
```

If `session.json` does not exist:
```json
{
  "success": false,
  "error": "No session found. Run: mst auth login"
}
```

On TTY, a human-readable summary is also printed to stderr. Stdout is always the JSON envelope.

---

## Mid-command expiry handling

When a scraper encounters a 401 response or a redirect to `login.microsoftonline.com` during a running command:

- Throw `SessionExpiredError`
- The command aborts immediately — no partial output is written
- The CLI top-level handler prints the standard expiry message and exits `1`

---

## Error types

| Error | Trigger |
|---|---|
| `SessionNotFoundError` | `~/.mst/session.json` does not exist |
| `SessionExpiredError` | Required auth cookies missing or past expiry, or scraper gets 401/login redirect |

---

## What is NOT in scope

- `mst auth logout` — not planned
- Automatic token refresh — re-auth is always manual via `mst auth login`
- Storing credentials — only the Playwright `storageState` is persisted
