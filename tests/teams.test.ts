import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResponse, mockPage, mockHandle } = vi.hoisted(() => {
  const response = { json: vi.fn() };
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

import { listTeams } from "../src/scrapers/teams.js";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const SESSION: StorageState = { cookies: [], origins: [] };

const RAW_TEAMS_RESPONSE = {
  teams: [
    {
      id: "19:abc@thread.tacv2",
      displayName: "Engineering",
      description: "The engineering team",
      isDeleted: false,
    },
    {
      id: "19:def@thread.tacv2",
      displayName: "Design",
      description: null,
      isDeleted: false,
    },
    {
      id: "19:ghi@thread.tacv2",
      displayName: "Old Team",
      description: "Should be excluded",
      isDeleted: true,
    },
  ],
  chats: [],
  metadata: { syncToken: "tok" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPage.waitForResponse.mockResolvedValue(mockResponse);
  mockPage.goto.mockResolvedValue(null);
  mockResponse.json.mockResolvedValue(RAW_TEAMS_RESPONSE);
});

// eslint-disable-next-line max-lines-per-function
describe("listTeams", () => {
  it("navigates to teams.microsoft.com", async () => {
    await listTeams(SESSION);
    expect(mockPage.goto).toHaveBeenCalledWith("https://teams.microsoft.com");
  });

  it("intercepts the csa teams/users/me endpoint", async () => {
    await listTeams(SESSION);
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
    await listTeams(SESSION);
    const [, options] = mockPage.waitForResponse.mock.calls[0];
    expect(options).toMatchObject({ timeout: 60_000 });
  });

  it("returns normalised Team objects for non-deleted teams", async () => {
    const teams = await listTeams(SESSION);
    expect(teams).toEqual([
      {
        id: "19:abc@thread.tacv2",
        displayName: "Engineering",
        description: "The engineering team",
      },
      { id: "19:def@thread.tacv2", displayName: "Design", description: null },
    ]);
  });

  it("excludes teams where isDeleted is true", async () => {
    const teams = await listTeams(SESSION);
    expect(teams.find((t) => t.displayName === "Old Team")).toBeUndefined();
  });

  it("sets description to null when missing from raw response", async () => {
    mockResponse.json.mockResolvedValue({
      teams: [{ id: "19:x@thread.tacv2", displayName: "No Desc", isDeleted: false }],
    });
    const teams = await listTeams(SESSION);
    expect(teams[0].description).toBeNull();
  });
});
