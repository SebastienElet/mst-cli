# Design: `mst channel list`

**Date:** 2026-07-08
**Status:** approved

## Command interface

```
mst channel list <team-id> [--json]
```

- `<team-id>` — required positional argument; the Teams internal ID as returned by `mst team list`
- `--json` — output JSON envelope instead of table; auto-enabled when stdout is not a TTY

## Scraper (`src/scrapers/channels.ts`)

New exported function:

```ts
export async function listChannels(session: StorageState, teamId: string): Promise<Channel[]>
```

**Channel type:**

```ts
export type Channel = {
  id: string;
  displayName: string;
  description: string | null;
};
```

**Implementation steps:**

1. Call `withBrowser(session, ...)` — same browser lifecycle as `listTeams`
2. Register a `waitForResponse` on a URL pattern matching the channels endpoint (exact pattern discovered during implementation via network inspection, expected shape: `/api\/csa\/.+\/teams\/<teamId>\/channels/u`)
3. Navigate to `https://teams.microsoft.com/_#/teamDetails/<team-id>` (exact deep-link URL confirmed during implementation)
4. If response is not OK → throw `SessionExpiredError`
5. Parse response body, filter `isDeleted === true`, map to `Channel[]`

The `teamId` is interpolated into the URL pattern regex so only the matching team's response is captured.

## Table output

```
NAME        ID                    DESCRIPTION
──────────  ────────────────────  ──────────────────────────────────────────────────────────────
General     19:abc123@thread...   Main discussion channel
Releases    19:def456@thread...   —
Long desc   19:ghi789@thread...   This is a very long description that gets truncated at 60 c…
```

Rules:
- NAME column width: `max(4, maxDisplayNameLength)`
- ID column width: `max(2, maxIdLength)`
- DESCRIPTION column width: `max(11, maxTruncatedDescriptionLength)` — descriptions truncated to 60 characters with `…` suffix; null or empty shown as `—`
- Header row, separator row (`─`), one row per channel — same pattern as `mst team list`

## JSON envelope

```json
{
  "success": true,
  "data": { "channels": [...] },
  "metadata": { "timestamp": "...", "duration_ms": 123 }
}
```

## CLI wiring (`src/cli.ts`)

Add a `channel` command group (parallel to the existing `team` group):

```ts
const channel = program.command("channel");

channel
  .command("list <teamId>")
  .description("List all channels for a team")
  .option("--json", "Output as JSON instead of table")
  .action(async (teamId: string, options: { json?: boolean }) => { ... });
```

The action follows the same structure as `team list`: start timer, ensure session, call scraper, branch on `--json` / TTY.

## Error handling

- Session not found / expired: existing `ensureValidSession()` throws `SessionNotFoundError` / `SessionExpiredError`, caught by the top-level error handler in `cli.ts`
- Invalid or non-existent `team-id`: Teams returns a non-OK response → `SessionExpiredError` is thrown and surfaced as "Session expired or not found. Run: mst auth login". A dedicated `NotFoundError` is out of scope for this spec.

## Testing

Unit tests in `src/scrapers/channels.test.ts`:

- Mock the Playwright page/response to return a fixture channels payload
- Assert `listChannels` filters deleted channels and maps fields correctly
- Assert `null` description is preserved

Integration tests (if applicable): invoke the CLI with `--json`, assert envelope shape and exit code 0.
