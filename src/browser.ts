import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type BrowserHandle = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

const DEFAULT_TIMEOUT = 30_000;

export async function withBrowser<T>(
  session: StorageState,
  fn: (handle: BrowserHandle) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: session });
    context.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);
    context.setDefaultTimeout(DEFAULT_TIMEOUT);
    const page = await context.newPage();
    return await fn({ browser, context, page });
  } finally {
    await browser.close();
  }
}
