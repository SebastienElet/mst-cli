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

import { listChats } from "../src/scrapers/chats.js";
import { SessionExpiredError } from "../src/errors.js";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const SESSION: StorageState = { cookies: [], origins: [] };

const RAW_CHATS_RESPONSE = {
  chats: [
    {
      id: "19:oneOnOne@unq.gbl.spaces",
      title: null,
      chatType: "chat",
      isOneOnOne: true,
      isConversationDeleted: false,
      members: [{ mri: "8:orgid:aaa" }, { mri: "8:orgid:bbb" }],
      lastMessage: { composeTime: "2026-07-08T07:05:15.8320000Z" },
    },
    {
      id: "19:namedGroup@thread.v2",
      title: "LOBBY Support/dev",
      chatType: "chat",
      isOneOnOne: false,
      isConversationDeleted: false,
      members: [{ mri: "8:orgid:aaa" }, { mri: "8:orgid:ccc" }, { mri: "8:orgid:ddd" }],
      lastMessage: { composeTime: "2026-07-10T06:44:45.4600000Z" },
    },
    {
      id: "19:unnamedGroup@thread.v2",
      title: null,
      chatType: "chat",
      isOneOnOne: false,
      isConversationDeleted: false,
      members: [{ mri: "8:orgid:aaa" }, { mri: "8:orgid:eee" }],
    },
    {
      id: "19:meeting_abc@thread.v2",
      title: "Stand up Équipe ETL",
      chatType: "meeting",
      isOneOnOne: false,
      isConversationDeleted: false,
      members: [{ mri: "8:orgid:aaa" }, { mri: "8:orgid:fff" }],
      lastMessage: { composeTime: "2026-07-10T07:36:35.6690000Z" },
    },
    {
      id: "19:deleted@thread.v2",
      title: "Should be excluded",
      chatType: "chat",
      isOneOnOne: false,
      isConversationDeleted: true,
      members: [{ mri: "8:orgid:aaa" }],
    },
  ],
  metadata: { isPartialData: false, hasMoreChats: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPage.waitForResponse.mockResolvedValue(mockResponse);
  mockPage.goto.mockResolvedValue(null);
  mockResponse.json.mockResolvedValue(RAW_CHATS_RESPONSE);
  mockResponse.ok.mockReturnValue(true);
});

// eslint-disable-next-line max-lines-per-function
describe("listChats", () => {
  it("navigates to teams.microsoft.com", async () => {
    await listChats(SESSION);
    expect(mockPage.goto).toHaveBeenCalledWith("https://teams.microsoft.com");
  });

  it("intercepts the csa teams/users/me endpoint", async () => {
    await listChats(SESSION);
    const [pattern] = mockPage.waitForResponse.mock.calls[0];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(
      (pattern as RegExp).test(
        "https://teams.cloud.microsoft/api/csa/emea/api/v3/teams/users/me?foo=1",
      ),
    ).toBe(true);
    expect(
      (pattern as RegExp).test("https://teams.cloud.microsoft/api/mt/part/emea/something"),
    ).toBe(false);
  });

  it("sets a 60s timeout on waitForResponse", async () => {
    await listChats(SESSION);
    const [, options] = mockPage.waitForResponse.mock.calls[0];
    expect(options).toMatchObject({ timeout: 60_000 });
  });

  it("returns type 'oneOnOne' for isOneOnOne chats", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:oneOnOne@unq.gbl.spaces");
    expect(chat).toMatchObject({ title: null, type: "oneOnOne" });
  });

  it("returns type 'group' for named non-meeting, non-1:1 chats", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:namedGroup@thread.v2");
    expect(chat).toMatchObject({ title: "LOBBY Support/dev", type: "group" });
  });

  it("returns type 'group' with null title for unnamed group chats", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:unnamedGroup@thread.v2");
    expect(chat).toMatchObject({ title: null, type: "group" });
  });

  it("returns type 'meeting' for meeting chats regardless of isOneOnOne", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:meeting_abc@thread.v2");
    expect(chat).toMatchObject({ title: "Stand up Équipe ETL", type: "meeting" });
  });

  it("extracts memberIds from members[].mri", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:namedGroup@thread.v2");
    expect(chat?.memberIds).toEqual(["8:orgid:aaa", "8:orgid:ccc", "8:orgid:ddd"]);
  });

  it("sets lastMessageTime to null when lastMessage is absent", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:unnamedGroup@thread.v2");
    expect(chat?.lastMessageTime).toBeNull();
  });

  it("sets lastMessageTime from lastMessage.composeTime when present", async () => {
    const chats = await listChats(SESSION);
    const chat = chats.find((c) => c.id === "19:namedGroup@thread.v2");
    expect(chat?.lastMessageTime).toBe("2026-07-10T06:44:45.4600000Z");
  });

  it("excludes chats where isConversationDeleted is true", async () => {
    const chats = await listChats(SESSION);
    expect(chats.find((c) => c.id === "19:deleted@thread.v2")).toBeUndefined();
  });

  it("throws SessionExpiredError when response is not ok", async () => {
    mockResponse.ok.mockReturnValue(false);
    await expect(listChats(SESSION)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
