import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserContext } from "playwright";
import { isSessionValid, loadSession, ensureValidSession, status } from "../src/auth.js";
import { SessionNotFoundError, SessionExpiredError } from "../src/errors.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const TEST_DIR = join(tmpdir(), `mst-test-${process.pid}`);
const TEST_SESSION = join(TEST_DIR, "session.json");

function makeCookie(name: string, expiresOffsetSec: number) {
  return {
    name,
    value: "test-value",
    domain: ".microsoft.com",
    path: "/",
    expires: Math.floor(Date.now() / 1000) + expiresOffsetSec,
    httpOnly: true,
    secure: true,
    sameSite: "None" as const,
  };
}

function makeState(cookies: ReturnType<typeof makeCookie>[]): StorageState {
  return { cookies, origins: [] };
}

describe("isSessionValid", () => {
  it("returns valid=false when ESTSAUTH is missing", () => {
    const state = makeState([makeCookie("ESTSAUTHPERSISTENT", 3600)]);
    expect(isSessionValid(state)).toEqual({ valid: false, expiresAt: null });
  });

  it("returns valid=false when ESTSAUTHPERSISTENT is missing", () => {
    const state = makeState([makeCookie("ESTSAUTH", 3600)]);
    expect(isSessionValid(state)).toEqual({ valid: false, expiresAt: null });
  });

  it("returns valid=false with expiresAt when a required cookie is expired", () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    const state = makeState([
      { ...makeCookie("ESTSAUTH", 0), expires: expiredAt },
      makeCookie("ESTSAUTHPERSISTENT", 3600),
    ]);
    const result = isSessionValid(state);
    expect(result.valid).toBe(false);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt!.getTime()).toBeCloseTo(expiredAt * 1000, -3);
  });

  it("returns valid=true when a cookie has expires=-1 (session cookie)", () => {
    const state = makeState([
      { ...makeCookie("ESTSAUTH", 3600), expires: -1 },
      makeCookie("ESTSAUTHPERSISTENT", 3600),
    ]);
    const result = isSessionValid(state);
    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("returns valid=true with earliest expiresAt when both cookies are valid", () => {
    const state = makeState([makeCookie("ESTSAUTH", 3600), makeCookie("ESTSAUTHPERSISTENT", 7200)]);
    const result = isSessionValid(state);
    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    const diffMs = result.expiresAt!.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(3500 * 1000);
    expect(diffMs).toBeLessThan(3700 * 1000);
  });
});

describe("loadSession", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("throws SessionNotFoundError when file does not exist", async () => {
    await expect(loadSession(TEST_SESSION)).rejects.toThrow(SessionNotFoundError);
  });

  it("returns parsed StorageState when file exists", async () => {
    const state = makeState([makeCookie("ESTSAUTH", 3600), makeCookie("ESTSAUTHPERSISTENT", 7200)]);
    await writeFile(TEST_SESSION, JSON.stringify(state));
    const result = await loadSession(TEST_SESSION);
    expect(result.cookies).toHaveLength(2);
    expect(result.cookies[0].name).toBe("ESTSAUTH");
  });
});

describe("ensureValidSession", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("throws SessionNotFoundError when file is missing", async () => {
    await expect(ensureValidSession(TEST_SESSION)).rejects.toThrow(SessionNotFoundError);
  });

  it("throws SessionExpiredError when session is expired", async () => {
    const state = makeState([
      { ...makeCookie("ESTSAUTH", 0), expires: Math.floor(Date.now() / 1000) - 60 },
      makeCookie("ESTSAUTHPERSISTENT", 3600),
    ]);
    await writeFile(TEST_SESSION, JSON.stringify(state));
    await expect(ensureValidSession(TEST_SESSION)).rejects.toThrow(SessionExpiredError);
  });

  it("returns StorageState when session is valid", async () => {
    const state = makeState([makeCookie("ESTSAUTH", 3600), makeCookie("ESTSAUTHPERSISTENT", 7200)]);
    await writeFile(TEST_SESSION, JSON.stringify(state));
    const result = await ensureValidSession(TEST_SESSION);
    expect(result.cookies).toHaveLength(2);
  });
});

describe("status", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("returns found=false when session file is missing", async () => {
    expect(await status(TEST_SESSION)).toEqual({ found: false, valid: false, expiresAt: null });
  });

  it("returns found=true, valid=false when session is expired", async () => {
    const state = makeState([
      { ...makeCookie("ESTSAUTH", 0), expires: Math.floor(Date.now() / 1000) - 60 },
      makeCookie("ESTSAUTHPERSISTENT", 3600),
    ]);
    await writeFile(TEST_SESSION, JSON.stringify(state));
    const result = await status(TEST_SESSION);
    expect(result.found).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.expiresAt).not.toBeNull();
  });

  it("returns found=true, valid=true with ISO expiresAt when valid", async () => {
    const state = makeState([makeCookie("ESTSAUTH", 3600), makeCookie("ESTSAUTHPERSISTENT", 7200)]);
    await writeFile(TEST_SESSION, JSON.stringify(state));
    const result = await status(TEST_SESSION);
    expect(result.found).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it("returns found=true, valid=false when session file is corrupt", async () => {
    await writeFile(TEST_SESSION, "not valid json {{{");
    const result = await status(TEST_SESSION);
    expect(result).toEqual({ found: true, valid: false, expiresAt: null });
  });
});
