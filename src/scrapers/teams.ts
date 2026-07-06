import type { BrowserContext } from "playwright";
import { withBrowser } from "../browser.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type Team = {
  id: string;
  displayName: string;
  description: string | null;
};

type RawTeam = {
  id: string;
  displayName: string;
  description?: string | null;
  isDeleted?: boolean;
};

type TeamsResponse = {
  teams: RawTeam[];
};

const TEAMS_URL_PATTERN = /\/api\/csa\/.+\/api\/v3\/teams\/users\/me/u;

export async function listTeams(session: StorageState): Promise<Team[]> {
  return await withBrowser(session, async ({ page }) => {
    const responsePromise = page.waitForResponse(TEAMS_URL_PATTERN, { timeout: 60_000 });
    await page.goto("https://teams.microsoft.com");
    const response = await responsePromise;
    const body = (await response.json()) as TeamsResponse;
    return body.teams
      .filter((t) => !t.isDeleted)
      .map((t) => ({
        id: t.id,
        displayName: t.displayName,
        description: t.description ?? null,
      }));
  });
}
