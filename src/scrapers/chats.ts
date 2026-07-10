import type { BrowserContext } from "playwright";
import { withBrowser } from "../browser.js";
import { SessionExpiredError } from "../errors.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type Chat = {
  id: string;
  title: string | null;
  type: "oneOnOne" | "group" | "meeting";
  memberIds: string[];
  lastMessageTime: string | null;
};

type RawChatMember = {
  mri: string;
};

type RawChat = {
  id: string;
  title?: string | null;
  chatType: string;
  isOneOnOne: boolean;
  isConversationDeleted?: boolean;
  members?: RawChatMember[];
  lastMessage?: { composeTime?: string };
};

type BootstrapResponse = {
  chats: RawChat[];
};

const TEAMS_URL_PATTERN = /\/api\/csa\/.+\/api\/v3\/teams\/users\/me/u;

function deriveType(chat: RawChat): "oneOnOne" | "group" | "meeting" {
  if (chat.chatType === "meeting") return "meeting";
  return chat.isOneOnOne ? "oneOnOne" : "group";
}

export async function listChats(session: StorageState): Promise<Chat[]> {
  return await withBrowser(session, async ({ page }) => {
    const responsePromise = page.waitForResponse(TEAMS_URL_PATTERN, { timeout: 60_000 });
    await page.goto("https://teams.microsoft.com");
    const response = await responsePromise;
    if (!response.ok()) throw new SessionExpiredError();
    const body = (await response.json()) as BootstrapResponse;
    return body.chats
      .filter((c) => !c.isConversationDeleted)
      .map((c) => ({
        id: c.id,
        title: c.title ?? null,
        type: deriveType(c),
        memberIds: (c.members ?? []).map((m) => m.mri),
        lastMessageTime: c.lastMessage?.composeTime ?? null,
      }));
  });
}
