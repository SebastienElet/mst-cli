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
  .action(async () => {
    const start = Date.now();
    const result = await status();
    const durationMs = Date.now() - start;

    if (!result.found) {
      console.log(
        JSON.stringify(errorEnvelope("No session found. Run: mst auth login", durationMs)),
      );
      if (process.stdout.isTTY) process.stderr.write("No session found. Run: mst auth login\n");
      process.exitCode = 1;
      return;
    }

    if (!result.valid) {
      console.log(
        JSON.stringify(
          errorEnvelope("Session expired. Run: mst auth login", durationMs, {
            valid: false,
            expiresAt: result.expiresAt,
          }),
        ),
      );
      if (process.stdout.isTTY) {
        process.stderr.write(`Session expired (${result.expiresAt}). Run: mst auth login\n`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(successEnvelope({ valid: true, expiresAt: result.expiresAt }, durationMs)),
    );
    if (process.stdout.isTTY) process.stderr.write(`Session valid, expires ${result.expiresAt}\n`);
  });

const team = program.command("team");

team
  .command("list")
  .description("List all joined teams")
  .action(async () => {
    const start = Date.now();
    const session = await ensureValidSession();
    const teams = await listTeams(session);
    const durationMs = Date.now() - start;
    console.log(JSON.stringify(successEnvelope({ teams }, durationMs)));
    if (process.stdout.isTTY) {
      for (const t of teams) {
        process.stderr.write(`${t.displayName}\t${t.id}\n`);
      }
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
