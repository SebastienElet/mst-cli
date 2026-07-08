# Design: `mst team list`

**Date:** 2026-07-06  
**Status:** Approved

## Overview

Implement the first data-fetching command: `mst team list`. Lists all Teams the authenticated user is a member of, as JSON to stdout.

## Discovery findings

Teams has migrated its web client from `teams.microsoft.com` to `teams.cloud.microsoft`. On initial load, the SPA fires a single request that returns all teams, chats, and metadata:

```
GET https://teams.cloud.microsoft/api/csa/{region}/api/v3/teams/users/me
    ?isPrefetch=false
    &enableMembershipSummary=true
    &supportsAdditionalSystemGeneratedFolders=true
    &supportsSliceItems=true
    &enableEngageCommunities=false
```

The `{region}` segment (e.g. `emea`) varies by tenant and is not known ahead of time. The approach is to navigate to `teams.microsoft.com`, let the browser redirect and fire this request naturally, then intercept the response by URL pattern.

### Response shape (relevant fields)

```json
{
  "teams": [
    {
      "id": "19:XjIPnziGzTVVC_4uq1W_1-PVhzpZ4gZ6vJMLS2XYTHw1@thread.tacv2",
      "displayName": "Septeo News",
      "description": "The place to follow group news.",
      "isDeleted": false,
      "channels": [ ... ]
    }
  ],
  "chats": [ ... ],
  "metadata": { "syncToken": "..." }
}
```

## Data type

```ts
// src/scrapers/teams.ts
export type Team = {
  id: string;           // raw thread ID, e.g. "19:abc...@thread.tacv2"
  displayName: string;
  description: string | null;
};
```

Channels are not included — they are a separate command.

## Scraper

**File:** `src/scrapers/teams.ts`  
**Export:** `listTeams(): Promise<Team[]>`

Algorithm:
1. Call `withBrowser(async (page) => { ... })` — loads the saved session automatically.
2. Set up a `page.waitForResponse()` listener matching `/api\/csa\/.+\/api\/v3\/teams\/users\/me/` before navigation.
3. Navigate to `https://teams.microsoft.com`.
4. Await the intercepted response (timeout: 60s).
5. Parse JSON, extract `body.teams`.
6. Filter out teams where `isDeleted === true`.
7. Map to `Team[]`: pick `id`, `displayName`, `description ?? null`.
8. Return the array.

## CLI wiring

**Command:** `mst team list`  
**File:** `src/cli.ts` — new `team` subcommand group.

```
mst team list
```

Stdout (always):
```json
{
  "success": true,
  "data": { "teams": [ { "id": "...", "displayName": "...", "description": "..." } ] },
  "metadata": { "timestamp": "...", "duration_ms": 123 }
}
```

Stderr (TTY only, one line per team):
```
Septeo News    19:XjIPnziGzTVVC_...@thread.tacv2
```

Exit codes:
- `0` — success
- `1` — session not found, session expired, or scraping error

Session errors are caught by the existing top-level handler in `cli.ts`.

## Files changed

| File | Change |
|------|--------|
| `src/scrapers/teams.ts` | New — `Team` type + `listTeams()` |
| `src/cli.ts` | Add `team` command group + `team list` subcommand |
