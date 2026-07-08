#!/usr/bin/env node
import { Command } from "commander";
import { login, status, ensureValidSession } from "./auth.js";
import { successEnvelope, errorEnvelope } from "./output.js";
import { SessionNotFoundError, SessionExpiredError } from "./errors.js";
import { listTeams } from "./scrapers/teams.js";
import { listChannels } from "./scrapers/channels.js";

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

program.parseAsync().catch((err: unknown) => {
  if (err instanceof SessionNotFoundError || err instanceof SessionExpiredError) {
    process.stderr.write("Session expired or not found. Run: mst auth login\n");
    process.exit(1);
  }
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
