# `mst channel list` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mst channel list <team-id>` command that lists channels for a given team in a table or JSON envelope.

**Architecture:** New `src/scrapers/channels.ts` mirrors the pattern in `src/scrapers/teams.ts` — navigate to a Teams URL, intercept the internal channels API response via Playwright, filter and return typed data. `src/cli.ts` gets a new `channel` command group with a `list` subcommand wired to the scraper.

**Tech Stack:** TypeScript, Playwright (Chromium), commander, vitest

## Global Constraints

- Node.js 24.18.0 (pinned via `.nvmrc`)
- pnpm 11.9.0 — use `pnpm`, never `npm`
- All dependencies pinned exactly (no `^` ranges)
- Tests use vitest — run with `pnpm test`
- Lint: `pnpm lint` (oxlint), Format: `pnpm format` (oxfmt)
- TypeScript strict mode — `pnpm build` must pass
- No Graph API usage
- All comments and documentation in English

---

### Task 1: Channel scraper

**Files:**
- Create: `src/scrapers/channels.ts`
- Create: `tests/channels.test.ts`

**Interfaces:**
- Consumes: `withBrowser` from `../browser.js`, `SessionExpiredError` from `../errors.js`
- Produces:
  ```ts
  export type Channel = {
    id: string;
    displayName: string;
    description: string | null;
  };
  export async function listChannels(session: StorageState, teamId: string): Promise<Channel[]>
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/channels.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResponse, mockPage, mockHandle } = vi.hoisted(() => {
  const response = { json: vi.fn(), ok: vi.fn().mockReturnValue(true) };
  const page = {
    waitForResponse: vi.fn().mockResolvedValue(response),
    goto: vi.fn().mockResolvedValue(null),
  };
  const handle = { browser: {}, context: {}, page };
  return { mockResponse: response, mockPage: page, mockHandle: handle };
});

vi.mock("../src/browser.js", () => ({
  withBrowser: vi
    .fn()
    .mockImplementation((_session: unknown, fn: (h: unknown) => unknown) => fn(mockHandle)),
}));

import { listChannels } from "../src/scrapers/channels.js";
import { SessionExpiredError } from "../src/errors.js";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const SESSION: StorageState = { cookies: [], origins: [] };
const TEAM_ID = "19:abc123@thread.tacv2";

const RAW_CHANNELS_RESPONSE = {
  value: [
    {
      id: "19:ch1@thread.tacv2",
      displayName: "General",
      description: "Main channel",
      isDeleted: false,
    },
    {
      id: "19:ch2@thread.tacv2",
      displayName: "Releases",
      description: null,
      isDeleted: false,
    },
    {
      id: "19:ch3@thread.tacv2",
      displayName: "Old Channel",
      description: "Should be excluded",
      isDeleted: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPage.waitForResponse.mockResolvedValue(mockResponse);
  mockPage.goto.mockResolvedValue(null);
  mockResponse.json.mockResolvedValue(RAW_CHANNELS_RESPONSE);
  mockResponse.ok.mockReturnValue(true);
});

describe("listChannels", () => {
  it("navigates to the team detail page", async () => {
    await listChannels(SESSION, TEAM_ID);
    expect(mockPage.goto).toHaveBeenCalledWith(
      `https://teams.microsoft.com/_#/teamDetails/${TEAM_ID}`,
    );
  });

  it("intercepts a URL containing /channels", async () => {
    await listChannels(SESSION, TEAM_ID);
    const [pattern] = mockPage.waitForResponse.mock.calls[0];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(
      (pattern as RegExp).test(
        "https://teams.cloud.microsoft/api/csa/emea/api/v3/teams/19%3Aabc123%40thread.tacv2/channels",
      ),
    ).toBe(true);
    expect(
      (pattern as RegExp).test("https://teams.cloud.microsoft/api/csa/emea/api/v3/teams/users/me"),
    ).toBe(false);
  });

  it("sets a 60s timeout on waitForResponse", async () => {
    await listChannels(SESSION, TEAM_ID);
    const [, options] = mockPage.waitForResponse.mock.calls[0];
    expect(options).toMatchObject({ timeout: 60_000 });
  });

  it("returns normalised Channel objects for non-deleted channels", async () => {
    const channels = await listChannels(SESSION, TEAM_ID);
    expect(channels).toEqual([
      { id: "19:ch1@thread.tacv2", displayName: "General", description: "Main channel" },
      { id: "19:ch2@thread.tacv2", displayName: "Releases", description: null },
    ]);
  });

  it("excludes channels where isDeleted is true", async () => {
    const channels = await listChannels(SESSION, TEAM_ID);
    expect(channels.find((c) => c.displayName === "Old Channel")).toBeUndefined();
  });

  it("sets description to null when missing from raw response", async () => {
    mockResponse.json.mockResolvedValue({
      value: [{ id: "19:x@thread.tacv2", displayName: "No Desc", isDeleted: false }],
    });
    const channels = await listChannels(SESSION, TEAM_ID);
    expect(channels[0].description).toBeNull();
  });

  it("throws SessionExpiredError when response is not ok", async () => {
    mockResponse.ok.mockReturnValue(false);
    await expect(listChannels(SESSION, TEAM_ID)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test tests/channels.test.ts
```

Expected: FAIL — "Cannot find module '../src/scrapers/channels.js'"

- [ ] **Step 3: Write the scraper**

Create `src/scrapers/channels.ts`:

```ts
import type { BrowserContext } from "playwright";
import { withBrowser } from "../browser.js";
import { SessionExpiredError } from "../errors.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type Channel = {
  id: string;
  displayName: string;
  description: string | null;
};

type RawChannel = {
  id: string;
  displayName: string;
  description?: string | null;
  isDeleted?: boolean;
};

type ChannelsResponse = {
  value: RawChannel[];
};

const CHANNELS_URL_PATTERN = /\/api\/csa\/.+\/channels/u;

export async function listChannels(session: StorageState, teamId: string): Promise<Channel[]> {
  return await withBrowser(session, async ({ page }) => {
    const responsePromise = page.waitForResponse(CHANNELS_URL_PATTERN, { timeout: 60_000 });
    await page.goto(`https://teams.microsoft.com/_#/teamDetails/${teamId}`);
    const response = await responsePromise;
    if (!response.ok()) throw new SessionExpiredError();
    const body = (await response.json()) as ChannelsResponse;
    return body.value
      .filter((c) => !c.isDeleted)
      .map((c) => ({
        id: c.id,
        displayName: c.displayName,
        description: c.description ?? null,
      }));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test tests/channels.test.ts
```

Expected: all 7 tests pass

- [ ] **Step 5: Lint and type-check**

```bash
pnpm lint && pnpm build
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/channels.ts tests/channels.test.ts
git commit -m "feat: add listChannels scraper with network interception"
```

---

### Task 2: CLI wiring

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes:
  - `listChannels(session: StorageState, teamId: string): Promise<Channel[]>` from `./scrapers/channels.js`
  - `Channel` type from `./scrapers/channels.js`
  - `ensureValidSession`, `successEnvelope` — already imported in `cli.ts`

- [ ] **Step 1: Add the import**

In `src/cli.ts`, add after the existing `listTeams` import on line 6:

```ts
import { listChannels } from "./scrapers/channels.js";
```

- [ ] **Step 2: Add the channel command group**

In `src/cli.ts`, add after the closing of the `team` block (after line 101, before `program.parseAsync()`):

```ts
const channel = program.command("channel");

channel
  .command("list <teamId>")
  .description("List all channels for a team")
  .option("--json", "Output as JSON instead of table")
  .action(async (teamId: string, options: { json?: boolean }) => {
    const start = Date.now();
    const session = await ensureValidSession();
    const channels = await listChannels(session, teamId);
    const durationMs = Date.now() - start;

    if (options.json || !process.stdout.isTTY) {
      console.log(JSON.stringify(successEnvelope({ channels }, durationMs)));
      return;
    }

    const truncate = (s: string | null): string => {
      if (!s) return "—";
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    };

    const truncated = channels.map((c) => ({ ...c, desc: truncate(c.description) }));
    const nameWidth = Math.max(4, ...channels.map((c) => c.displayName.length));
    const idWidth = Math.max(2, ...channels.map((c) => c.id.length));
    const descWidth = Math.max(11, ...truncated.map((c) => c.desc.length));

    console.log(`${"NAME".padEnd(nameWidth)}  ${"ID".padEnd(idWidth)}  DESCRIPTION`);
    console.log(
      `${"─".repeat(nameWidth)}  ${"─".repeat(idWidth)}  ${"─".repeat(descWidth)}`,
    );
    for (const c of truncated) {
      console.log(
        `${c.displayName.padEnd(nameWidth)}  ${c.id.padEnd(idWidth)}  ${c.desc}`,
      );
    }
  });
```

- [ ] **Step 3: Lint, format, and type-check**

```bash
pnpm format && pnpm lint && pnpm build
```

Expected: no errors

- [ ] **Step 4: Smoke test (manual)**

```bash
pnpm dev channel list --help
```

Expected output:
```
Usage: mst channel list [options] <teamId>

List all channels for a team

Options:
  --json    Output as JSON instead of table
  -h, --help  display help for command
```

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add mst channel list command"
```
