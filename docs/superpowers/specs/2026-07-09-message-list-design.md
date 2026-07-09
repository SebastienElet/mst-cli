# Design: `mst message list`

**Date:** 2026-07-09
**Status:** approved

## Scope

Covers channel messages only (`--channel <channel-id>`). Chat (1:1/group) messages use a
different conversation ID scheme and are deferred to a separate future spec.

## Discovery findings

Verified live against a real Teams session (read-only network inspection, no UI automation
needed for the final approach).

### Endpoint

```
GET https://teams.cloud.microsoft/api/chatsvc/{region}/v1/users/ME/conversations/{channelId}/messages
    ?view=msnp24Equivalent|supportsMessageProperties
    &pageSize=200
    &startTime=1
```

- `{region}` (e.g. `emea`) varies by tenant, same as the `teams/users/me` bootstrap call.
- `{channelId}` is the URL-encoded channel ID (e.g. `19:abc...@thread.tacv2`), globally unique —
  no team ID is needed to address it.
- Requires an `authorization` bearer header that Teams' own JS attaches; a bare `fetch()` from
  the page returns `401`. Confirmed the header is **generic**: one captured from *any* chatsvc
  call (Teams fires calls for `48:notifications` / `48:mentions` automatically on every load) can
  be reused via `context.request.get(url, { headers })` to call *any other* conversation's
  messages endpoint successfully.

### Pagination

Each response includes:

```json
{
  "messages": [ /* newest first */ ],
  "_metadata": {
    "lastCompleteSegmentStartTime": 1780505213665,
    "lastCompleteSegmentEndTime": 1783591083764,
    "backwardLink": "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/.../messages?startTime=...&syncState=...&pageSize=200&view=msnp24Equivalent",
    "syncState": "..."
  }
}
```

`_metadata.backwardLink` is a fully-formed URL for the next (older) page. Its absence signals no
more history. Confirmed working end-to-end: repeatedly following `backwardLink` with the same
captured headers returns progressively older pages of the same conversation.

### Message shape (relevant fields, confirmed live)

```json
{
  "sequenceId": 971,
  "conversationid": "19:abc...@thread.tacv2",
  "type": "Message",
  "messagetype": "RichText/Html",
  "rootMessageId": "1783348228267",
  "id": "1783348247403",
  "content": "<p>message body with <span itemtype=\"http://schema.skype.com/Mention\">mentions</span></p>",
  "imdisplayname": "Some Person",
  "composetime": "2026-07-06T14:30:47.4030000Z"
}
```

- **Reply/thread model:** every message has `rootMessageId`. When `rootMessageId === id`, it's a
  root post. When they differ, `rootMessageId` points at the parent post's `id` — this is a reply.
  There is no separate nested-tree structure; replies live in the same flat `messages` array as
  root posts.
- **System events:** the same stream mixes in non-chat activity: observed `messagetype` values
  include `ThreadActivity/AddMember`, `ThreadActivity/DeleteMember`,
  `ThreadActivity/AddCustomApp`, alongside real content (`RichText/Html`, `Text`).
- **Content:** arrives as HTML (mentions/emoji rendered as `<span>`/`<img>` tags).

## Data type

```ts
// src/scrapers/messages.ts
export type Message = {
  id: string;
  rootMessageId: string;
  isReply: boolean;           // derived: rootMessageId !== id
  kind: "message" | "system"; // "system" when messagetype starts with "ThreadActivity/"
  from: string | null;        // imdisplayname; null if absent
  content: string;            // HTML tags stripped to plain text
  composeTime: string;        // ISO timestamp, from `composetime`
};
```

## Scraper

**File:** `src/scrapers/messages.ts`
**Export:** `listMessages(session: StorageState, channelId: string): Promise<Message[]>`

Algorithm:

1. Call `withBrowser(session, async ({ page, context }) => { ... })`.
2. Set up two `page.waitForRequest()` promises before navigating: the existing bootstrap pattern
   (`TEAMS_URL_PATTERN`, matching `teams.ts`) and a new
   `CHATSVC_URL_PATTERN = /\/api\/chatsvc\/([^/]+)\/v1\/users\/ME\/conversations\//u`.
3. Navigate to `https://teams.microsoft.com`. Await both promises (timeout: 60s each, same as
   the existing bootstrap wait) — Teams fires its own chatsvc calls (`48:notifications`,
   `48:mentions`) as part of normal bootstrap, so the second promise resolves without any UI
   interaction.
4. If the chatsvc request wait times out → throw `SessionExpiredError`. Otherwise extract its
   headers and the `region` (regex capture group) for reuse.
5. Build the initial messages URL for `channelId` with `pageSize=200&startTime=1`.
6. Loop:
   - `const res = await context.request.get(url, { headers: capturedHeaders })`
   - If `!res.ok()` → throw `SessionExpiredError`
   - Parse body, push `body.messages` into an accumulator
   - If `body._metadata?.backwardLink` is present, set `url` to it and repeat; otherwise stop
7. Reverse the accumulated list (each page is newest-first) so the returned array is chronological
   oldest → newest.
8. Map each raw message to `Message`:
   - `kind`: `"system"` if `messagetype` starts with `"ThreadActivity/"`, else `"message"`
   - `isReply`: `rootMessageId !== id`
   - `from`: `imdisplayname ?? null`
   - `content`: pass raw HTML `content` through an HTML-stripping helper (regex tag removal +
     HTML entity decoding — no new dependency; matches this repo's pinned-deps convention)
   - `composeTime`: `composetime`

No team ID is needed by the scraper — channel IDs are globally unique in this API.

## CLI wiring (`src/cli.ts`)

```
mst message list --channel <channel-id> [--json]
```

```ts
const message = program.command("message");

message
  .command("list")
  .description("List all messages in a channel")
  .requiredOption("--channel <channelId>", "Channel ID")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { channel: string; json?: boolean }) => { ... });
```

Action follows the same structure as `channel list`: start timer, `ensureValidSession()`, call
`listMessages`, branch on `--json` / TTY.

## Table output

```
TIME              FROM              KIND     REPLY  CONTENT
────────────────  ────────────────  ───────  ─────  ──────────────────────────────────────────
2026-07-06 14:30  Alice Martin      message  —      Check here for organization announcements…
2026-07-06 14:31  Bob Dupont        message  ✓      Thanks for the update!
2026-07-07 09:00  —                 system   —      —
```

Rules:
- Columns: `TIME` (composeTime formatted local, fixed width), `FROM` (`max(4, maxFromLength)`,
  `—` if null), `KIND` (fixed width `7`, values `message`/`system`), `REPLY` (fixed width `5`,
  `✓` or `—`), `CONTENT` (`max(7, maxTruncatedContentLength)`, truncated to 60 characters with
  `…` — same rule as `channel list`'s description column; `—` if empty)
- Header row, separator row (`─`), one row per message — same pattern as existing list commands

## JSON envelope

```json
{
  "success": true,
  "data": { "messages": [...] },
  "metadata": { "timestamp": "...", "duration_ms": 123 }
}
```

## Error handling

- Session not found / expired: existing `ensureValidSession()` throws `SessionNotFoundError` /
  `SessionExpiredError`, caught by the top-level handler in `cli.ts`.
- No chatsvc request observed within the bootstrap wait, or any paginated request returns
  non-OK: `SessionExpiredError`.
- Invalid or non-existent `channelId`: exact API behavior (empty `messages` array vs. an error
  response) was not confirmed against a live invalid ID. Treated as out of scope, same gap noted
  in the channel-list spec — a dedicated `NotFoundError` is not part of this spec.

## Testing

Existing scrapers (`teams.ts`, `channels.ts`) already have tests in the top-level `tests/`
directory (not colocated with `src/`), using `vi.hoisted` to build a mock `page`/`response` and
`vi.mock("../src/browser.js", ...)` to stub `withBrowser`. No `vitest.config` file exists —
default discovery already picks up `tests/*.test.ts`.

Unit tests in `tests/messages.test.ts`, following that existing pattern:
- Mock `context.request.get` to return two pages (first with `_metadata.backwardLink` set,
  second without) — assert the pagination loop follows the link and stops correctly.
- Assert `kind` is `"system"` for `messagetype` starting with `"ThreadActivity/"`, `"message"`
  otherwise.
- Assert `isReply` is `true` when `rootMessageId !== id`, `false` when equal.
- Assert HTML content is stripped to plain text (tags removed, entities decoded).
- Assert final array order is chronological oldest → newest.

Integration tests (if applicable): invoke the CLI with `--json`, assert envelope shape and exit
code 0.
