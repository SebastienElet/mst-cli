import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { SessionNotFoundError, SessionExpiredError } from './errors.js';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export const SESSION_DIR = join(homedir(), '.mst');
export const SESSION_PATH = join(SESSION_DIR, 'session.json');

const REQUIRED_COOKIES = ['ESTSAUTH', 'ESTSAUTHPERSISTENT'] as const;

export function isSessionValid(state: StorageState): { valid: boolean; expiresAt: Date | null } {
  const nowSec = Math.floor(Date.now() / 1000);
  let earliestExpiry: number | null = null;

  for (const name of REQUIRED_COOKIES) {
    const cookie = state.cookies.find(c => c.name === name);
    if (!cookie || cookie.expires <= 0) return { valid: false, expiresAt: null };
    if (cookie.expires < nowSec) return { valid: false, expiresAt: new Date(cookie.expires * 1000) };
    if (earliestExpiry === null || cookie.expires < earliestExpiry) {
      earliestExpiry = cookie.expires;
    }
  }

  return { valid: true, expiresAt: earliestExpiry ? new Date(earliestExpiry * 1000) : null };
}

export async function loadSession(sessionPath = SESSION_PATH): Promise<StorageState> {
  try {
    const raw = await readFile(sessionPath, 'utf8');
    return JSON.parse(raw) as StorageState;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new SessionNotFoundError();
    throw e;
  }
}

export async function ensureValidSession(sessionPath = SESSION_PATH): Promise<StorageState> {
  const state = await loadSession(sessionPath);
  const { valid } = isSessionValid(state);
  if (!valid) throw new SessionExpiredError();
  return state;
}

export async function status(
  sessionPath = SESSION_PATH,
): Promise<{ found: boolean; valid: boolean; expiresAt: string | null }> {
  let state: StorageState;
  try {
    state = await loadSession(sessionPath);
  } catch (e) {
    if (e instanceof SessionNotFoundError) {
      return { found: false, valid: false, expiresAt: null };
    }
    return { found: true, valid: false, expiresAt: null };
  }
  const { valid, expiresAt } = isSessionValid(state);
  return { found: true, valid, expiresAt: expiresAt?.toISOString() ?? null };
}

export async function login(): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://teams.microsoft.com');

  // Wait for Teams to redirect to login, then for user to complete login and return to Teams
  await page.waitForURL(/login\.microsoftonline\.com/, { timeout: 30_000 }).catch(() => {});

  try {
    await page.waitForURL(
      url => url.hostname === 'teams.microsoft.com',
      { timeout: 5 * 60 * 1000 },
    );
  } catch {
    process.stderr.write('Login cancelled — browser closed before authentication completed.\n');
    await browser.close().catch(() => {});
    process.exit(1);
  }

  await mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  const state = await context.storageState();
  await writeFile(SESSION_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  await browser.close();

  process.stderr.write(`Session saved to ${SESSION_PATH}\n`);
}
