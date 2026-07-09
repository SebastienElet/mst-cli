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
        messages: [
          { ...RAW_ROOT, id: "4", rootMessageId: "4" },
          { ...RAW_ROOT, id: "3", rootMessageId: "3" },
        ],
        _metadata: { backwardLink: "https://teams.cloud.microsoft/next-page" },
      })
      .mockResolvedValueOnce({
        messages: [
          { ...RAW_ROOT, id: "2", rootMessageId: "2" },
          { ...RAW_ROOT, id: "1", rootMessageId: "1" },
        ],
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
