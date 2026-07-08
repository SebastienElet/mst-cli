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

type RawTeam = {
  id: string;
  channels?: RawChannel[];
  isDeleted?: boolean;
};

type TeamsResponse = {
  teams: RawTeam[];
};

const TEAMS_URL_PATTERN = /\/api\/csa\/.+\/api\/v3\/teams\/users\/me/u;

export async function listChannels(session: StorageState, teamId: string): Promise<Channel[]> {
  return await withBrowser(session, async ({ page }) => {
    const responsePromise = page.waitForResponse(TEAMS_URL_PATTERN, { timeout: 60_000 });
    await page.goto("https://teams.microsoft.com");
    const response = await responsePromise;
    if (!response.ok()) throw new SessionExpiredError();
    const body = (await response.json()) as TeamsResponse;
    const team = body.teams.find((t) => t.id === teamId);
    if (!team) return [];
    return (team.channels ?? [])
      .filter((c) => !c.isDeleted)
      .map((c) => ({
        id: c.id,
        displayName: c.displayName,
        description: c.description ?? null,
      }));
  });
}
