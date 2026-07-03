import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BrowserHandle } from "../src/browser.js";

const { mockPage, mockContext, mockBrowser } = vi.hoisted(() => {
  const page = { goto: vi.fn() };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockPage: page, mockContext: context, mockBrowser: browser };
});

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

import { chromium } from "playwright";
import { withBrowser } from "../src/browser.js";
import type { BrowserContext } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const SESSION: StorageState = { cookies: [], origins: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowser.newContext.mockResolvedValue(mockContext);
  mockContext.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
});

// eslint-disable-next-line max-lines-per-function
describe("withBrowser", () => {
  it("launches headless Chromium", async () => {
    await withBrowser(SESSION, () => Promise.resolve("ok"));
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
  });

  it("creates context with the provided session", async () => {
    await withBrowser(SESSION, () => Promise.resolve("ok"));
    expect(mockBrowser.newContext).toHaveBeenCalledWith({ storageState: SESSION });
  });

  it("sets default timeouts to 30 seconds", async () => {
    await withBrowser(SESSION, () => Promise.resolve("ok"));
    expect(mockContext.setDefaultNavigationTimeout).toHaveBeenCalledWith(30_000);
    expect(mockContext.setDefaultTimeout).toHaveBeenCalledWith(30_000);
  });

  it("calls fn with browser, context, and page", async () => {
    let received: BrowserHandle | undefined;
    await withBrowser(SESSION, (handle) => {
      received = handle;
      return Promise.resolve();
    });
    expect(received).toMatchObject({
      browser: mockBrowser,
      context: mockContext,
      page: mockPage,
    });
  });

  it("returns the value returned by fn", async () => {
    const result = await withBrowser(SESSION, () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("closes the browser after fn resolves", async () => {
    await withBrowser(SESSION, () => Promise.resolve("ok"));
    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });

  it("closes the browser even when fn throws", async () => {
    await expect(
      withBrowser(SESSION, () => {
        throw new Error("scraper failed");
      }),
    ).rejects.toThrow("scraper failed");
    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });

  it("propagates errors thrown by fn", async () => {
    const err = new Error("oops");
    await expect(
      withBrowser(SESSION, () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});
