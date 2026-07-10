#!/usr/bin/env node
import { Command } from "commander";
import { login, status, ensureValidSession } from "./auth.js";
import { successEnvelope, errorEnvelope } from "./output.js";
import { SessionNotFoundError, SessionExpiredError } from "./errors.js";
import { listTeams } from "./scrapers/teams.js";
import { listChannels } from "./scrapers/channels.js";
import { listMessages } from "./scrapers/messages.js";
import { listChats } from "./scrapers/chats.js";

const program = new Command();
program.name("mst").description("Microsoft Teams CLI");

function printAuthStatusTable(statusLabel: string, expiresAt: string | null): void {
  const STATUS_W = "not found".length;
  console.log(`${"STATUS".padEnd(STATUS_W)}  EXPIRES`);
  console.log(`${"─".repeat(STATUS_W)}  ${"─".repeat(36)}`);
  console.log(`${statusLabel.padEnd(STATUS_W)}  ${expiresAt ?? "—"}`);
}

const auth = program.command("auth");

auth
  .command("login")
  .description("Open browser and log in to Microsoft Teams")
  .action(async () => {
    await login();
  });

auth
  .command("status")
  .description("Check saved session validity")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { json?: boolean }) => {
    const start = Date.now();
    const result = await status();
    const durationMs = Date.now() - start;
    const asJson = options.json || !process.stdout.isTTY;

    if (!result.found) {
      if (asJson) {
        console.log(
          JSON.stringify(errorEnvelope("No session found. Run: mst auth login", durationMs)),
        );
      } else {
        printAuthStatusTable("not found", null);
        process.stderr.write("Run: mst auth login\n");
      }
      process.exitCode = 1;
      return;
    }

    if (!result.valid) {
      if (asJson) {
        console.log(
          JSON.stringify(
            errorEnvelope("Session expired. Run: mst auth login", durationMs, {
              valid: false,
              expiresAt: result.expiresAt,
            }),
          ),
        );
      } else {
        printAuthStatusTable("expired", result.expiresAt);
        process.stderr.write("Run: mst auth login\n");
      }
      process.exitCode = 1;
      return;
    }

    if (asJson) {
      console.log(
        JSON.stringify(successEnvelope({ valid: true, expiresAt: result.expiresAt }, durationMs)),
      );
    } else {
      printAuthStatusTable("valid", result.expiresAt);
    }
  });

const team = program.command("team");

team
  .command("list")
  .description("List all joined teams")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { json?: boolean }) => {
    const start = Date.now();
    const session = await ensureValidSession();
    const teams = await listTeams(session);
    const durationMs = Date.now() - start;

    if (options.json || !process.stdout.isTTY) {
      console.log(JSON.stringify(successEnvelope({ teams }, durationMs)));
      return;
    }

    const nameWidth = Math.max(4, ...teams.map((t) => t.displayName.length));
    const idWidth = Math.max(2, ...teams.map((t) => t.id.length));
    console.log(`${"NAME".padEnd(nameWidth)}  ID`);
    console.log(`${"─".repeat(nameWidth)}  ${"─".repeat(idWidth)}`);
    for (const t of teams) {
      console.log(`${t.displayName.padEnd(nameWidth)}  ${t.id}`);
    }
  });

const channel = program.command("channel");

channel
  .command("list <teamId>")
  .description("List all channels for a team")
  .option("--json", "Output as JSON instead of table")
  .action(async (teamId: string, options: { json?: boolean }) => {
    const start = Date.now();
    const session = await ensureValidSession();
    const channels = await listChannels(session, teamId);
    const durationMs = Date.now() - start;

    if (options.json || !process.stdout.isTTY) {
      console.log(JSON.stringify(successEnvelope({ channels }, durationMs)));
      return;
    }

    const truncate = (s: string | null): string => {
      if (!s) return "—";
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    };

    const truncated = channels.map((c) => ({ ...c, desc: truncate(c.description) }));
    const nameWidth = Math.max(4, ...channels.map((c) => c.displayName.length));
    const idWidth = Math.max(2, ...channels.map((c) => c.id.length));
    const descWidth = Math.max(11, ...truncated.map((c) => c.desc.length));

    console.log(`${"NAME".padEnd(nameWidth)}  ${"ID".padEnd(idWidth)}  DESCRIPTION`);
    console.log(`${"─".repeat(nameWidth)}  ${"─".repeat(idWidth)}  ${"─".repeat(descWidth)}`);
    for (const c of truncated) {
      console.log(`${c.displayName.padEnd(nameWidth)}  ${c.id.padEnd(idWidth)}  ${c.desc}`);
    }
  });

const message = program.command("message");

message
  .command("list")
  .description("List all messages in a channel")
  .requiredOption("--channel <channelId>", "Channel ID")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { channel: string; json?: boolean }) => {
    const start = Date.now();
    const session = await ensureValidSession();
    const messages = await listMessages(session, options.channel);
    const durationMs = Date.now() - start;

    if (options.json || !process.stdout.isTTY) {
      console.log(JSON.stringify(successEnvelope({ messages }, durationMs)));
      return;
    }

    const truncate = (s: string): string => {
      if (!s) return "—";
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    };

    const rows = messages.map((m) => ({
      time: m.composeTime.replace("T", " ").slice(0, 16),
      from: m.from ?? "—",
      kind: m.kind,
      reply: m.isReply ? "✓" : "—",
      content: truncate(m.content),
    }));

    const timeWidth = Math.max(4, ...rows.map((r) => r.time.length));
    const fromWidth = Math.max(4, ...rows.map((r) => r.from.length));
    const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
    const replyWidth = Math.max(5, ...rows.map((r) => r.reply.length));
    const contentWidth = Math.max(7, ...rows.map((r) => r.content.length));

    console.log(
      `${"TIME".padEnd(timeWidth)}  ${"FROM".padEnd(fromWidth)}  ${"KIND".padEnd(kindWidth)}  ${"REPLY".padEnd(replyWidth)}  CONTENT`,
    );
    console.log(
      `${"─".repeat(timeWidth)}  ${"─".repeat(fromWidth)}  ${"─".repeat(kindWidth)}  ${"─".repeat(replyWidth)}  ${"─".repeat(contentWidth)}`,
    );
    for (const r of rows) {
      console.log(
        `${r.time.padEnd(timeWidth)}  ${r.from.padEnd(fromWidth)}  ${r.kind.padEnd(kindWidth)}  ${r.reply.padEnd(replyWidth)}  ${r.content}`,
      );
    }
  });

const chat = program.command("chat");

chat
  .command("list")
  .description("List all chats (1:1, group, and meeting threads)")
  .option("--json", "Output as JSON instead of table")
  .action(async (options: { json?: boolean }) => {
    const start = Date.now();
    const session = await ensureValidSession();
    const chats = await listChats(session);
    const durationMs = Date.now() - start;

    if (options.json || !process.stdout.isTTY) {
      console.log(JSON.stringify(successEnvelope({ chats }, durationMs)));
      return;
    }

    const rows = chats.map((c) => ({
      title: c.title ?? "—",
      type: c.type,
      members: String(c.memberIds.length),
      lastMessage: c.lastMessageTime ? c.lastMessageTime.replace("T", " ").slice(0, 16) : "—",
    }));

    const titleWidth = Math.max(5, ...rows.map((r) => r.title.length));
    const typeWidth = 8;
    const membersWidth = 7;
    const lastMessageWidth = Math.max(12, ...rows.map((r) => r.lastMessage.length));

    console.log(
      `${"TITLE".padEnd(titleWidth)}  ${"TYPE".padEnd(typeWidth)}  ${"MEMBERS".padEnd(membersWidth)}  LAST MESSAGE`,
    );
    console.log(
      `${"─".repeat(titleWidth)}  ${"─".repeat(typeWidth)}  ${"─".repeat(membersWidth)}  ${"─".repeat(lastMessageWidth)}`,
    );
    for (const r of rows) {
      console.log(
        `${r.title.padEnd(titleWidth)}  ${r.type.padEnd(typeWidth)}  ${r.members.padEnd(membersWidth)}  ${r.lastMessage}`,
      );
    }
  });

program.parseAsync().catch((err: unknown) => {
  if (err instanceof SessionNotFoundError || err instanceof SessionExpiredError) {
    process.stderr.write("Session expired or not found. Run: mst auth login\n");
    process.exit(1);
  }
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
