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

// eslint-disable-next-line max-lines-per-function
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
    expect(
      (pattern as RegExp).test(
        "https://teams.cloud.microsoft/api/csa/emea/api/v3/teams/19%3Aother%40thread.tacv2/channels",
      ),
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
