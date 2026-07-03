# mst-cli

A TypeScript CLI that scrapes Microsoft Teams via Playwright — for organisations where the Microsoft Graph API is not permitted.

Navigates `teams.microsoft.com` in a headless browser, intercepts the internal API responses Teams makes to its own backend, and writes everything as Markdown files so AI agents can search and read them.

## Approach

- **No Graph API** — works entirely through the Teams web client
- **Auth once** — `mst auth login` opens a browser, you log in manually; session is saved to `~/.mst/session.json` and reused
- **Network interception** — captures Teams' own internal XHR/fetch responses (already structured JSON) rather than scraping the DOM
- **Markdown storage** — data is written to a directory you control, structured for agent search

## Primary workflow

```bash
# 1. Authenticate once
mst auth login

# 2. Sync everything to a directory
mst sync --output ./teams-data

# 3. Point your agents at ./teams-data and let them search
```

## Storage format

`mst sync --output <dir>` produces this layout:

```
<dir>/
  _index.md                          # All teams and chats overview
  teams/
    <team-slug>/
      _index.md                      # Team metadata + member list
      <channel-slug>/
        _index.md                    # Channel metadata + last sync timestamp
        messages/
          2026-01.md                 # Immutable once the month has passed
          2026-06.md                 # Immutable
          2026-07.md                 # Current month — append-only on each sync
  chats/
    <chat-slug>/
      _index.md                      # Participants + last sync timestamp
      messages/
        2026-07.md
```

Slugs are human-readable (`engineering`, `general`) derived from the display name. Raw IDs are stored inside each `_index.md` for reference.

**Incremental sync**: each `_index.md` stores the timestamp of the last fetched message. On re-sync, only messages newer than that timestamp are fetched and appended to the current month file. Past month files are never rewritten.

### `_index.md` — team example

```markdown
# Engineering

- **ID**: `19:abc123...`
- **Description**: Main engineering team
- **Members**: Alice (owner), Bob, Carol

## Channels
- [General](./general/_index.md)
- [Releases](./releases/_index.md)
```

### `_index.md` — channel example

```markdown
# general

- **ID**: `19:xyz789...`
- **Team**: Engineering
- **Last synced**: 2026-07-02T08:00:00Z
- **Last message**: 2026-07-01T10:45:00Z

## Messages
- [2026-07](./messages/2026-07.md)
- [2026-06](./messages/2026-06.md)
```

### `messages/2026-07.md` — format

```markdown
# Messages — #general — July 2026

## 2026-07-01 10:23 — Alice Martin

Build pipeline is green. Deploying to staging now.

---

## 2026-07-01 10:45 — Bob Dupont

> Build pipeline is green. Deploying to staging now.

LGTM, go ahead.

---
```

Each message block includes: timestamp (ISO, local), sender display name, content (HTML stripped to plain text), and quoted replies inline.

## Commands (planned)

```bash
# Auth
mst auth login                        # Open browser, log in, save session
mst auth status                       # Check saved session validity

# Full sync
mst sync --output <dir>               # Fetch everything and write markdown
mst sync --output <dir> --team <id>   # Sync a single team only
mst sync --output <dir> --chat <id>   # Sync a single chat only

# Raw fetch (stdout JSON, for scripting)
mst team list
mst team get <team-id>
mst channel list <team-id>
mst channel get <team-id> <channel-id>
mst message list --team <id> --channel <id>
mst message list --chat <chat-id>
mst chat list
mst chat get <chat-id>
```

## JSON output envelope (raw commands)

```json
{
  "success": true,
  "data": { "..." : "..." },
  "metadata": { "timestamp": "...", "duration_ms": 123 }
}
```

## Project structure (planned)

```
src/
  cli.ts              # Entry point — command definitions (commander)
  browser.ts          # Playwright lifecycle — launch, session load/save
  output.ts           # JSON envelope formatting + TTY tables
  sync.ts             # Orchestrates full sync, writes markdown files
  markdown.ts         # Markdown rendering from scraped data
  scrapers/
    teams.ts
    channels.ts
    messages.ts
    chats.ts
```

## Tech stack

- TypeScript + Node.js
- [Playwright](https://playwright.dev) (Chromium)
- [commander](https://github.com/tj/commander.js) for CLI arg parsing

---

## TODO — Specs to write

Each spec covers one slice of the system. Write them one at a time before implementing.

- [x] **spec: auth** — login flow, session save/load format, expiry detection, re-auth prompting
- [x] **spec: browser** — Playwright setup, headless config, session injection, page lifecycle, teardown
- [ ] **spec: scrapers** — URL navigation patterns, network intercept filters, response normalisation for teams/channels/messages/chats
- [ ] **spec: storage** — directory layout, slug generation, `_index.md` schema, monthly file naming, immutability contract, incremental update strategy (last message timestamp in `_index.md`)
- [ ] **spec: sync** — orchestration order, parallelism, progress reporting, partial failure handling
- [ ] **spec: markdown renderer** — message formatting rules, HTML stripping, reply quoting, attachment stubs
- [ ] **spec: output** — JSON envelope shape, exit codes, TTY vs pipe auto-detection
- [ ] **spec: cli wiring** — commander command tree, flag names, help text, error handling
