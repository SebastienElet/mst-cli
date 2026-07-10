# Design: `mst chat list`

**Date:** 2026-07-10
**Status:** approved

## Scope

Lists 1:1 chats, group chats, and meeting chat threads for the authenticated user. Member
display-name resolution (mapping an MRI to a human-readable name) is **out of scope** — see
"Known gap" below.

## Discovery findings

Verified live against a real Teams session (read-only network inspection via a throwaway probe
script, no UI automation needed for the final approach).

### Endpoint

No new endpoint. Chats ride the same bootstrap call already used by `team list` / `channel list`:

```
GET https://teams.cloud.microsoft/api/csa/{region}/api/v3/teams/users/me
    ?isPrefetch=false&enableMembershipSummary=true
    &supportsAdditionalSystemGeneratedFolders=true&supportsSliceItems=true
    &enableEngageCommunities=false
```

The response body has a `chats` array (145 entries in the session tested) alongside the existing
`teams` array.

### Completeness

Confirmed via `body.metadata`:

```json
{
  "isPartialData": false,
  "hasMoreChats": false
}
```

This is the full chat set for the account, not a recent/active-window sample — no pagination is
needed.

### Chat shape (relevant fields, confirmed live)

```json
{
  "id": "19:0322459f-...@unq.gbl.spaces",
  "title": null,
  "chatType": "chat",
  "isOneOnOne": true,
  "isConversationDeleted": false,
  "hidden": true,
  "members": [
    { "mri": "8:orgid:0322459f-...", "role": "Admin" },
    { "mri": "8:orgid:7fb6e48f-...", "role": "Admin" }
  ],
  "lastMessage": {
    "composeTime": "2026-07-08T07:05:15.8320000Z",
    "content": "...",
    "from": "8:orgid:7fb6e48f-..."
  }
}
```

- `chatType` observed values: `"chat"` (1:1 or group) and `"meeting"` (thread tied to a
  calendar meeting). `isOneOnOne` disambiguates `"chat"` further into 1:1 vs. group.
- `title`: `null` for 1:1 chats; set to a real name for named group chats and for meeting chats
  (the meeting subject). Some group chats also have `title: null` (never renamed by any member).
- `hidden`: **not a delete/archive signal.** Empirically, most active chats (including ones with
  a `lastMessage` from today) have `hidden: true` — it reflects an unrelated UI-visibility state,
  not applicable here. Not used for filtering.
- `isConversationDeleted`: observed `false` on all 145 chats in the test session, but follows the
  same shape as `isDeleted` on teams/channels — filtered the same way for consistency.
- `members[].mri`: raw MRI string (e.g. `8:orgid:<guid>`), no display name attached.

### Known gap: no display-name resolution

The bootstrap payload's top-level `users` array is empty, and `teams[]` entries have no `members`
list either — there is no cheap, in-payload way to resolve an MRI to a display name. The UI
resolves this via separate calls observed during discovery (`.../beta/users/fetchShortProfile`,
and `profilepicturev2/{mri}?displayname=...` query params carrying the name as a side effect of
avatar fetches). Resolving names is deferred to a future spec — likely relevant when the storage/
sync spec renders chat `_index.md` participant lists. For this command, `memberIds` (raw MRIs)
and `id` are the join keys; the TTY table shows `—` for chats with no `title`.

## Data type

```ts
// src/scrapers/chats.ts
export type Chat = {
  id: string;
  title: string | null;
  type: "oneOnOne" | "group" | "meeting"; // derived, see below
  memberIds: string[];                    // raw MRIs, from members[].mri
  lastMessageTime: string | null;         // lastMessage.composeTime, or null if absent
};
```

`type` derivation: `chatType === "meeting" ? "meeting" : isOneOnOne ? "oneOnOne" : "group"`.

No `--type` filter flag in this spec (YAGNI) — all three kinds are returned; JSON/agent consumers
filter downstream if needed.

## Scraper

**File:** `src/scrapers/chats.ts`
**Export:** `listChats(session: StorageState): Promise<Chat[]>`

Algorithm (mirrors `listTeams`/`listChannels` exactly — same bootstrap call, same interception):

1. Call `withBrowser(session, async ({ page }) => { ... })`.
2. `page.waitForResponse(TEAMS_URL_PATTERN, { timeout: 60_000 })` before navigating —
   `TEAMS_URL_PATTERN = /\/api\/csa\/.+\/api\/v3\/teams\/users\/me/u` (identical pattern to
   `teams.ts`/`channels.ts`).
3. Navigate to `https://teams.microsoft.com`.
4. Await the response. If not OK → throw `SessionExpiredError`.
5. Parse the body, filter `body.chats` where `isConversationDeleted !== true`.
6. Map each raw chat to `Chat`:
   - `id`: passthrough
   - `title`: passthrough (`?? null`)
   - `type`: derived per the rule above
   - `memberIds`: `members.map(m => m.mri)`
   - `lastMessageTime`: `lastMessage?.composeTime ?? null`

No pagination, no second network call — same single-response shape as `listTeams`.

## CLI wiring (`src/cli.ts`)

```
mst chat list [--json]
```

```ts
const chat = program.command("chat");

chat
  .command("list")
  .description("List all chats (1:1, group, and meeting threads)")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { json?: boolean }) => { ... });
```

Action follows the same structure as `team list`/`channel list`: start timer, `ensureValidSession()`,
call `listChats`, branch on `--json` / TTY.

## Table output

```
TITLE                TYPE       MEMBERS  LAST MESSAGE
────────────────────  ─────────  ───────  ────────────────
LOBBY Support/dev     group      9        2026-07-10 06:44
Stand up Équipe ETL   meeting    12       2026-07-10 07:36
—                     oneOnOne   2        2026-07-08 07:05
```

Rules:
- `TITLE`: `max(5, maxTitleLength)`, `—` if `null` (no truncation rule needed — group/meeting
  titles observed well under 60 chars; revisit if that changes)
- `TYPE`: fixed width `8` (longest value `oneOnOne`)
- `MEMBERS`: fixed width `7`, `memberIds.length`
- `LAST MESSAGE`: `lastMessageTime` formatted local (`T` replaced with space, sliced to minute
  precision — same rule as `message list`'s `TIME` column), `—` if `null`
- Header row, separator row (`─`), one row per chat — same pattern as existing list commands

## JSON envelope

```json
{
  "success": true,
  "data": { "chats": [...] },
  "metadata": { "timestamp": "...", "duration_ms": 123 }
}
```

## Error handling

- Session not found / expired: existing `ensureValidSession()` throws `SessionNotFoundError` /
  `SessionExpiredError`, caught by the top-level handler in `cli.ts`.
- Bootstrap response not OK: `SessionExpiredError` (same as `team list`/`channel list`).

## Testing

Unit tests in `tests/chats.test.ts`, following the existing `tests/channels.test.ts` pattern
(`vi.hoisted` mock `page`/`response`, `vi.mock("../src/browser.js", ...)` to stub `withBrowser`):

- Mock the bootstrap response to return a fixture `chats` array covering: a 1:1 chat
  (`isOneOnOne: true`, `title: null`), a named group chat, an unnamed group chat, and a meeting
  chat (`chatType: "meeting"`).
- Assert `type` derivation is correct for all four cases.
- Assert `memberIds` is extracted from `members[].mri`.
- Assert chats with `isConversationDeleted: true` are excluded.
- Assert `lastMessageTime` is `null` when `lastMessage` is absent.

Integration tests (if applicable): invoke the CLI with `--json`, assert envelope shape and exit
code 0.
