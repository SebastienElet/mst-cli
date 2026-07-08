#!/usr/bin/env node
import { Command } from "commander";
import { login, status, ensureValidSession } from "./auth.js";
import { successEnvelope, errorEnvelope } from "./output.js";
import { SessionNotFoundError, SessionExpiredError } from "./errors.js";
import { listTeams } from "./scrapers/teams.js";

const program = new Command();
program.name("mst").description("Microsoft Teams CLI");

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
  .option("--json", "Output as JSON instead of status line")
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
        process.stderr.write("No session found. Run: mst auth login\n");
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
        process.stderr.write(`Session expired (${result.expiresAt}). Run: mst auth login\n`);
      }
      process.exitCode = 1;
      return;
    }

    if (asJson) {
      console.log(
        JSON.stringify(successEnvelope({ valid: true, expiresAt: result.expiresAt }, durationMs)),
      );
    } else {
      console.log(`Session valid, expires ${result.expiresAt}`);
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

program.parseAsync().catch((err: unknown) => {
  if (err instanceof SessionNotFoundError || err instanceof SessionExpiredError) {
    process.stderr.write("Session expired or not found. Run: mst auth login\n");
    process.exit(1);
  }
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
