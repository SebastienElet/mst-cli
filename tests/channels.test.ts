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

const RAW_TEAMS_RESPONSE = {
  teams: [
    {
      id: TEAM_ID,
      isDeleted: false,
      channels: [
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
    },
    {
      id: "19:other@thread.tacv2",
      isDeleted: false,
      channels: [
        { id: "19:ch9@thread.tacv2", displayName: "Other Team Channel", isDeleted: false },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPage.waitForResponse.mockResolvedValue(mockResponse);
  mockPage.goto.mockResolvedValue(null);
  mockResponse.json.mockResolvedValue(RAW_TEAMS_RESPONSE);
  mockResponse.ok.mockReturnValue(true);
});

// eslint-disable-next-line max-lines-per-function
describe("listChannels", () => {
  it("navigates to teams.microsoft.com", async () => {
    await listChannels(SESSION, TEAM_ID);
    expect(mockPage.goto).toHaveBeenCalledWith("https://teams.microsoft.com");
  });

  it("intercepts the csa teams/users/me endpoint", async () => {
    await listChannels(SESSION, TEAM_ID);
    const [pattern] = mockPage.waitForResponse.mock.calls[0];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(
      (pattern as RegExp).test(
        "https://teams.cloud.microsoft/api/csa/emea/api/v3/teams/users/me?foo=1",
      ),
    ).toBe(true);
    expect(
      (pattern as RegExp).test("https://teams.cloud.microsoft/api/csa/amer/api/v3/teams/users/me"),
    ).toBe(true);
    expect(
      (pattern as RegExp).test("https://teams.cloud.microsoft/api/mt/part/emea/something"),
    ).toBe(false);
  });

  it("sets a 60s timeout on waitForResponse", async () => {
    await listChannels(SESSION, TEAM_ID);
    const [, options] = mockPage.waitForResponse.mock.calls[0];
    expect(options).toMatchObject({ timeout: 60_000 });
  });

  it("returns normalised Channel objects for the matching team only", async () => {
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

  it("does not return channels from other teams", async () => {
    const channels = await listChannels(SESSION, TEAM_ID);
    expect(channels.find((c) => c.displayName === "Other Team Channel")).toBeUndefined();
  });

  it("sets description to null when missing from raw response", async () => {
    mockResponse.json.mockResolvedValue({
      teams: [
        {
          id: TEAM_ID,
          channels: [{ id: "19:x@thread.tacv2", displayName: "No Desc", isDeleted: false }],
        },
      ],
    });
    const channels = await listChannels(SESSION, TEAM_ID);
    expect(channels[0].description).toBeNull();
  });

  it("returns empty array when teamId is not found", async () => {
    const channels = await listChannels(SESSION, "19:nonexistent@thread.tacv2");
    expect(channels).toEqual([]);
  });

  it("throws SessionExpiredError when response is not ok", async () => {
    mockResponse.ok.mockReturnValue(false);
    await expect(listChannels(SESSION, TEAM_ID)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
