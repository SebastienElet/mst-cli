# `mst message list` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mst message list --channel <channel-id> [--json]`, fetching every message in a Teams channel (paginated, chronological, replies flagged) as JSON or a table.

**Architecture:** New `src/scrapers/messages.ts` exports `listMessages(session, channelId)`. It reuses the existing `withBrowser` lifecycle, passively captures a chatsvc auth header/region during the normal bootstrap navigation (no UI automation), then paginates the `chatsvc` messages endpoint via `context.request.get`, following `_metadata.backwardLink` until it's exhausted. `src/cli.ts` gets a new `message` command group mirroring the existing `team`/`channel` groups.

**Tech Stack:** TypeScript, Playwright (`BrowserContext.request` for authenticated HTTP calls outside the page), commander, vitest.

## Global Constraints

- No Graph API — Teams is scraped via its own internal web-client endpoints only (per `CLAUDE.md`).
- Dependencies are pinned exactly, no `^` ranges — this plan adds no new dependency (HTML stripping is a small regex helper, not a library).
- Every command supports `--json`; TTY gets a human-readable table, non-TTY defaults to JSON (per `AGENTS.md` CLI output conventions).
- Exit codes: `0` success, `1` error (existing top-level handler in `cli.ts` already covers `SessionNotFoundError`/`SessionExpiredError`).
- Tests live in the top-level `tests/` directory (not colocated with `src/`), following the existing `tests/teams.test.ts` / `tests/channels.test.ts` pattern: `vi.hoisted` mock objects + `vi.mock("../src/browser.js", ...)` stubbing `withBrowser`. No `vitest.config` file exists or is needed — default discovery already picks up `tests/*.test.ts`.

---

### Task 1: `listMessages` scraper

**Files:**
- Create: `src/scrapers/messages.ts`
- Test: `tests/messages.test.ts`

**Interfaces:**
- Consumes: `withBrowser` from `../src/browser.js` (signature: `withBrowser<T>(session, fn: (handle: { browser, context, page }) => Promise<T>): Promise<T>`), `SessionExpiredError` from `../src/errors.js`.
- Produces: `export type Message = { id: string; rootMessageId: string; isReply: boolean; kind: "message" | "system"; from: string | null; content: string; composeTime: string }` and `export async function listMessages(session: StorageState, channelId: string): Promise<Message[]>`, both consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `tests/messages.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockBootstrapResponse,
  mockChatsvcRequest,
  mockApiResponse,
  mockPage,
  mockContext,
  mockHandle,
} = vi.hoisted(() => {
  const bootstrapResponse = { ok: vi.fn().mockReturnValue(true) };
  const chatsvcRequest = {
    url: vi
      .fn()
      .mockReturnValue(
        "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/48%3Anotifications/messages?view=msnp24Equivalent&pageSize=200&startTime=1",
      ),
    headers: vi.fn().mockReturnValue({ authorization: "Bearer test-token" }),
  };
  const apiResponse = { ok: vi.fn().mockReturnValue(true), json: vi.fn() };
  const page = {
    waitForResponse: vi.fn().mockResolvedValue(bootstrapResponse),
    waitForRequest: vi.fn().mockResolvedValue(chatsvcRequest),
    goto: vi.fn().mockResolvedValue(null),
  };
  const context = { request: { get: vi.fn().mockResolvedValue(apiResponse) } };
  const handle = { browser: {}, context, page };
  return {
    mockBootstrapResponse: bootstrapResponse,
    mockChatsvcRequest: chatsvcRequest,
    mockApiResponse: apiResponse,
    mockPage: page,
    mockContext: context,
    mockHandle: handle,
  };
});

vi.mock("../src/browser.js", () => ({
  withBrowser: vi
    .fn()
    .mockImplementation((_session: unknown, fn: (h: unknown) => unknown) => fn(mockHandle)),
}));

import { listMessages } from "../src/scrapers/messages.js";
import { SessionExpiredError } from "../src/errors.js";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const SESSION: StorageState = { cookies: [], origins: [] };
const CHANNEL_ID = "19:abc@thread.tacv2";

const RAW_ROOT = {
  id: "100",
  rootMessageId: "100",
  messagetype: "RichText/Html",
  imdisplayname: "Alice",
  content: "<p>Hello <b>world</b>&nbsp;!</p>",
  composetime: "2026-07-01T10:00:00.0000000Z",
};
const RAW_REPLY = {
  id: "101",
  rootMessageId: "100",
  messagetype: "Text",
  imdisplayname: "Bob",
  content: "Reply text",
  composetime: "2026-07-01T10:05:00.0000000Z",
};
const RAW_SYSTEM = {
  id: "102",
  rootMessageId: "102",
  messagetype: "ThreadActivity/AddMember",
  content: "",
  composetime: "2026-07-01T10:10:00.0000000Z",
};
const RAW_NO_FROM = {
  id: "103",
  rootMessageId: "103",
  messagetype: "Text",
  content: "no sender",
  composetime: "2026-07-01T10:15:00.0000000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPage.waitForResponse.mockResolvedValue(mockBootstrapResponse);
  mockPage.waitForRequest.mockResolvedValue(mockChatsvcRequest);
  mockPage.goto.mockResolvedValue(null);
  mockBootstrapResponse.ok.mockReturnValue(true);
  mockChatsvcRequest.headers.mockReturnValue({ authorization: "Bearer test-token" });
  mockChatsvcRequest.url.mockReturnValue(
    "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/48%3Anotifications/messages?view=msnp24Equivalent&pageSize=200&startTime=1",
  );
  mockContext.request.get.mockResolvedValue(mockApiResponse);
  mockApiResponse.ok.mockReturnValue(true);
  mockApiResponse.json.mockResolvedValue({
    messages: [RAW_REPLY, RAW_ROOT, RAW_SYSTEM, RAW_NO_FROM],
  });
});

// eslint-disable-next-line max-lines-per-function
describe("listMessages", () => {
  it("navigates to teams.microsoft.com", async () => {
    await listMessages(SESSION, CHANNEL_ID);
    expect(mockPage.goto).toHaveBeenCalledWith("https://teams.microsoft.com");
  });

  it("builds the chatsvc URL from the captured region and channelId", async () => {
    await listMessages(SESSION, CHANNEL_ID);
    const [url] = mockContext.request.get.mock.calls[0];
    expect(url).toBe(
      "https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/" +
        "19%3Aabc%40thread.tacv2/messages?view=msnp24Equivalent|supportsMessageProperties&pageSize=200&startTime=1",
    );
  });

  it("passes the captured headers to context.request.get", async () => {
    await listMessages(SESSION, CHANNEL_ID);
    const [, options] = mockContext.request.get.mock.calls[0];
    expect(options).toEqual({ headers: { authorization: "Bearer test-token" } });
  });

  it("marks messages as replies when rootMessageId differs from id", async () => {
    const messages = await listMessages(SESSION, CHANNEL_ID);
    expect(messages.find((m) => m.id === "101")?.isReply).toBe(true);
    expect(messages.find((m) => m.id === "100")?.isReply).toBe(false);
  });

  it("marks ThreadActivity/* messages as kind 'system', others as 'message'", async () => {
    const messages = await listMessages(SESSION, CHANNEL_ID);
    expect(messages.find((m) => m.id === "102")?.kind).toBe("system");
    expect(messages.find((m) => m.id === "100")?.kind).toBe("message");
  });

  it("sets from to null when imdisplayname is missing", async () => {
    const messages = await listMessages(SESSION, CHANNEL_ID);
    expect(messages.find((m) => m.id === "103")?.from).toBeNull();
  });

  it("strips HTML tags and decodes entities from content", async () => {
    const messages = await listMessages(SESSION, CHANNEL_ID);
    expect(messages.find((m) => m.id === "100")?.content).toBe("Hello world !");
  });

  it("follows _metadata.backwardLink until it is absent, then returns chronological order", async () => {
    mockApiResponse.json
      .mockResolvedValueOnce({
        messages: [{ ...RAW_ROOT, id: "4", rootMessageId: "4" }, { ...RAW_ROOT, id: "3", rootMessageId: "3" }],
        _metadata: { backwardLink: "https://teams.cloud.microsoft/next-page" },
      })
      .mockResolvedValueOnce({
        messages: [{ ...RAW_ROOT, id: "2", rootMessageId: "2" }, { ...RAW_ROOT, id: "1", rootMessageId: "1" }],
      });

    const messages = await listMessages(SESSION, CHANNEL_ID);

    expect(mockContext.request.get).toHaveBeenCalledTimes(2);
    expect(mockContext.request.get.mock.calls[1][0]).toBe(
      "https://teams.cloud.microsoft/next-page",
    );
    expect(messages.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("throws SessionExpiredError when the chatsvc request wait times out", async () => {
    mockPage.waitForRequest.mockRejectedValue(new Error("Timeout"));
    await expect(listMessages(SESSION, CHANNEL_ID)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("throws SessionExpiredError when a paginated request is not ok", async () => {
    mockApiResponse.ok.mockReturnValue(false);
    await expect(listMessages(SESSION, CHANNEL_ID)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/messages.test.ts`
Expected: FAIL — `Cannot find module '../src/scrapers/messages.js'` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/scrapers/messages.ts`:

```ts
import type { BrowserContext } from "playwright";
import { withBrowser } from "../browser.js";
import { SessionExpiredError } from "../errors.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type Message = {
  id: string;
  rootMessageId: string;
  isReply: boolean;
  kind: "message" | "system";
  from: string | null;
  content: string;
  composeTime: string;
};

type RawMessage = {
  id: string;
  rootMessageId: string;
  messagetype: string;
  imdisplayname?: string;
  content: string;
  composetime: string;
};

type MessagesResponse = {
  messages: RawMessage[];
  _metadata?: { backwardLink?: string };
};

const TEAMS_URL_PATTERN = /\/api\/csa\/.+\/api\/v3\/teams\/users\/me/u;
const CHATSVC_URL_PATTERN = /\/api\/chatsvc\/([^/]+)\/v1\/users\/ME\/conversations\//u;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .trim();
}

export async function listMessages(
  session: StorageState,
  channelId: string,
): Promise<Message[]> {
  return await withBrowser(session, async ({ page, context }) => {
    const bootstrapPromise = page.waitForResponse(TEAMS_URL_PATTERN, { timeout: 60_000 });
    const chatsvcPromise = page.waitForRequest(CHATSVC_URL_PATTERN, { timeout: 60_000 });
    await page.goto("https://teams.microsoft.com");
    await bootstrapPromise;

    let chatsvcRequest;
    try {
      chatsvcRequest = await chatsvcPromise;
    } catch {
      throw new SessionExpiredError();
    }

    const region = CHATSVC_URL_PATTERN.exec(chatsvcRequest.url())?.[1];
    if (!region) throw new SessionExpiredError();
    const headers = chatsvcRequest.headers();

    let url: string | undefined =
      `https://teams.cloud.microsoft/api/chatsvc/${region}/v1/users/ME/conversations/` +
      `${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent|supportsMessageProperties&pageSize=200&startTime=1`;

    const raw: RawMessage[] = [];
    while (url) {
      const response = await context.request.get(url, { headers });
      if (!response.ok()) throw new SessionExpiredError();
      const body = (await response.json()) as MessagesResponse;
      raw.push(...body.messages);
      url = body._metadata?.backwardLink;
    }

    return raw.reverse().map((m) => ({
      id: m.id,
      rootMessageId: m.rootMessageId,
      isReply: m.rootMessageId !== m.id,
      kind: (m.messagetype.startsWith("ThreadActivity/") ? "system" : "message") as
        | "message"
        | "system",
      from: m.imdisplayname ?? null,
      content: stripHtml(m.content),
      composeTime: m.composetime,
    }));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/messages.test.ts`
Expected: `Test Files 1 passed (1)`, all 11 tests passed, 0 failed.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc -p tsconfig.json --noEmit && pnpm lint`
Expected: no errors from either command.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `pnpm test`
Expected: `Test Files 5 passed (5)` (4 existing + this new one), all tests passed.

- [ ] **Step 7: Commit**

```bash
git add src/scrapers/messages.ts tests/messages.test.ts
git commit -m "feat: add listMessages scraper with pagination and reply detection"
```

---

### Task 2: CLI wiring for `mst message list`

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md:121` (drop `--team`, matching the approved spec's dropped flag)

**Interfaces:**
- Consumes: `listMessages(session: StorageState, channelId: string): Promise<Message[]>` and `Message` type from Task 1 (`../src/scrapers/messages.js`); `ensureValidSession`, `successEnvelope` — both already used by the existing `channel list` command in this file.
- Produces: the `mst message list --channel <id> [--json]` CLI command. Nothing downstream in this repo consumes it yet (terminal command).

- [ ] **Step 1: Add the `message` command group**

In `src/cli.ts`, add this import alongside the existing scraper imports (after `import { listChannels } from "./scrapers/channels.js";`):

```ts
import { listMessages } from "./scrapers/messages.js";
```

Add this block after the existing `channel` command group (after the closing `});` of `channel.command("list <teamId>")`, before `program.parseAsync()...`):

```ts
const message = program.command("message");

message
  .command("list")
  .description("List all messages in a channel")
  .requiredOption("--channel <channelId>", "Channel ID")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { channel: string; json?: boolean }) => {
    const start = Date.now();
    const session = await ensureValidSession();
    const messages = await listMessages(session, options.channel);
    const durationMs = Date.now() - start;

    if (options.json || !process.stdout.isTTY) {
      console.log(JSON.stringify(successEnvelope({ messages }, durationMs)));
      return;
    }

    const truncate = (s: string): string => {
      if (!s) return "—";
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    };

    const rows = messages.map((m) => ({
      time: m.composeTime.replace("T", " ").slice(0, 16),
      from: m.from ?? "—",
      kind: m.kind,
      reply: m.isReply ? "✓" : "—",
      content: truncate(m.content),
    }));

    const timeWidth = Math.max(4, ...rows.map((r) => r.time.length));
    const fromWidth = Math.max(4, ...rows.map((r) => r.from.length));
    const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
    const replyWidth = Math.max(5, ...rows.map((r) => r.reply.length));
    const contentWidth = Math.max(7, ...rows.map((r) => r.content.length));

    console.log(
      `${"TIME".padEnd(timeWidth)}  ${"FROM".padEnd(fromWidth)}  ${"KIND".padEnd(kindWidth)}  ${"REPLY".padEnd(replyWidth)}  CONTENT`,
    );
    console.log(
      `${"─".repeat(timeWidth)}  ${"─".repeat(fromWidth)}  ${"─".repeat(kindWidth)}  ${"─".repeat(replyWidth)}  ${"─".repeat(contentWidth)}`,
    );
    for (const r of rows) {
      console.log(
        `${r.time.padEnd(timeWidth)}  ${r.from.padEnd(fromWidth)}  ${r.kind.padEnd(kindWidth)}  ${r.reply.padEnd(replyWidth)}  ${r.content}`,
      );
    }
  });
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc -p tsconfig.json --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke test against a live session**

Requires an existing valid session (`mst auth status` reports `valid`) and a real channel ID (from `mst channel list <team-id> --json`).

Run: `pnpm dev message list --channel "<a real channel id>" --json`
Expected: exit code 0, stdout is a single JSON line matching `{"success":true,"data":{"messages":[...]},"metadata":{...}}` — `data.messages` is an array (empty is fine for a quiet channel) where each element has `id`, `rootMessageId`, `isReply`, `kind`, `from`, `content`, `composeTime` keys.

Run: `pnpm dev message list --channel "<a real channel id>"` (no `--json`, TTY)
Expected: exit code 0, a table with `TIME  FROM  KIND  REPLY  CONTENT` header and one row per message.

- [ ] **Step 4: Update README's planned command example**

In `README.md`, change line 121 from:

```
mst message list --team <id> --channel <id>
```

to:

```
mst message list --channel <id>
```

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts README.md
git commit -m "feat: add mst message list command"
```
