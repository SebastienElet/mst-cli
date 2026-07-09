import type { BrowserContext } from "playwright";
import { withBrowser } from "../browser.js";
import { SessionExpiredError } from "../errors.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type Message = {
  id: string;
  rootMessageId: string;
  isReply: boolean;
  kind: "message" | "system";
  from: string | null;
  content: string;
  composeTime: string;
};

type RawMessage = {
  id: string;
  rootMessageId: string;
  messagetype: string;
  imdisplayname?: string;
  content: string;
  composetime: string;
};

type MessagesResponse = {
  messages: RawMessage[];
  // eslint-disable-next-line no-underscore-dangle
  _metadata?: { backwardLink?: string };
};

const TEAMS_URL_PATTERN = /\/api\/csa\/.+\/api\/v3\/teams\/users\/me/u;
const CHATSVC_URL_PATTERN = /\/api\/chatsvc\/([^/]+)\/v1\/users\/ME\/conversations\//u;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .trim();
}

export async function listMessages(session: StorageState, channelId: string): Promise<Message[]> {
  return await withBrowser(session, async ({ page, context }) => {
    const bootstrapPromise = page.waitForResponse(TEAMS_URL_PATTERN, { timeout: 60_000 });
    const chatsvcPromise = page.waitForRequest(CHATSVC_URL_PATTERN, { timeout: 60_000 });
    await page.goto("https://teams.microsoft.com");
    await bootstrapPromise;

    let chatsvcRequest;
    try {
      chatsvcRequest = await chatsvcPromise;
    } catch {
      throw new SessionExpiredError();
    }

    const region = CHATSVC_URL_PATTERN.exec(chatsvcRequest.url())?.[1];
    if (!region) throw new SessionExpiredError();
    const headers = chatsvcRequest.headers();

    let url: string | undefined =
      `https://teams.cloud.microsoft/api/chatsvc/${region}/v1/users/ME/conversations/` +
      `${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent|supportsMessageProperties&pageSize=200&startTime=1`;

    const raw: RawMessage[] = [];
    while (url) {
      const response = await context.request.get(url, { headers });
      if (!response.ok()) throw new SessionExpiredError();
      const body = (await response.json()) as MessagesResponse;
      raw.push(...body.messages);
      // eslint-disable-next-line no-underscore-dangle
      url = body._metadata?.backwardLink;
    }

    return raw.reverse().map((m) => ({
      id: m.id,
      rootMessageId: m.rootMessageId,
      isReply: m.rootMessageId !== m.id,
      kind: (m.messagetype.startsWith("ThreadActivity/") ? "system" : "message") as
        | "message"
        | "system",
      from: m.imdisplayname ?? null,
      content: stripHtml(m.content),
      composeTime: m.composetime,
    }));
  });
}
