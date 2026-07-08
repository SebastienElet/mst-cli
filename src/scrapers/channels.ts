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
