# mst-cli — Agent context

## Purpose

CLI tool to fetch Microsoft Teams data (teams, channels, messages, chats) by scraping `teams.microsoft.com` via Playwright. The Microsoft Graph API is not available in the target organisation.

## Tech stack

- TypeScript + Node.js **24.18.0** (pinned via `.nvmrc` and `engines`)
- pnpm **11.9.0** (pinned via `packageManager` field) — use `pnpm install`, not `npm install`
- Playwright (Chromium) — headless browser automation
- commander — CLI argument parsing

All dependency versions are pinned exactly (no `^` ranges) in `package.json` and locked in `pnpm-lock.yaml`.

## Architecture

```
src/
  cli.ts           # Command definitions
  browser.ts       # Playwright session management
  output.ts        # JSON envelope + TTY formatting
  scrapers/        # One file per resource type
```

## Rules

- No Graph API usage
- Read-only — no writes to Teams
- All raw commands output `{ success, data, metadata }` JSON to stdout
- Specs live in `docs/superpowers/specs/` — check README TODO before implementing a feature

## Auth

Session stored at `~/.mst/session.json` (Playwright `storageState`). Commands load this file to restore the authenticated browser context. `mst auth login` is the only command that runs headed.

## Storage (primary output for agents)

`mst sync --output <dir>` writes all Teams data as Markdown:

```
<dir>/
  _index.md                    # Overview of all teams and chats
  teams/
    <team-slug>/
      _index.md                # Team name, ID, description, members, channel list
      <channel-slug>/
        _index.md              # Channel name, ID, last sync timestamp, last message timestamp
        messages/
          2026-07.md           # Current month — append-only on each sync
          2026-06.md           # Past month — immutable, safe to cache/index
  chats/
    <chat-slug>/
      _index.md                # Participants, last sync timestamp
      messages/
        2026-07.md
```

**Message format (`messages/YYYY-MM.md`):**
```markdown
# Messages — #general — July 2026

## 2026-07-01 10:23 — Alice Martin

Message body here.

---

## 2026-07-01 10:45 — Bob Dupont

> Alice Martin: Message body here.

Reply content.

---
```

**Key properties for agents:**
- Past month files are immutable — index them once, never re-index
- Current month file is append-only — only tail changes between syncs
- `grep -r "keyword" <dir>` works across all teams/channels/chats
- Each `_index.md` is a human-readable summary and table of contents
- Slugs are derived from display names (lowercase, hyphenated); raw IDs are in each `_index.md`
