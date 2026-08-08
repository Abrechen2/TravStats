import { Client } from "discord.js";
import { readFileSync } from "node:fs";
import { createClient, loadEnv } from "./client.js";
import { ensureRoles } from "./roles.js";
import { ensureStructure } from "./guildStructure.js";
import { postRulesAndWelcome } from "./rulesMessage.js";
import { writeState } from "./state.js";
import { runServe } from "./reactionRole.js";
import { runRead } from "./readChannel.js";
import { runReply } from "./replyThread.js";
import { resolveReplyInput } from "./replyArgs.js";
import {
  runAnnounce,
  readRepoVersion,
  readRepoChangelog,
  AnnounceType,
} from "./announce.js";
import { extractChangelogEntry } from "./changelog.js";
import { log } from "./log.js";

async function runSetup(client: Client, guildId: string, dryRun: boolean): Promise<void> {
  const guild = await client.guilds.fetch(guildId);
  const full = await guild.fetch();
  log(dryRun ? "=== DRY RUN — no changes will be made ===" : "=== TravStats setup ===");
  await ensureRoles(full, dryRun);
  const { rulesChannelId } = await ensureStructure(full, dryRun);
  const rulesMessageId = await postRulesAndWelcome(full, rulesChannelId, dryRun);
  if (!dryRun) writeState({ guildId, rulesMessageId });
  log("done.");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const { token, guildId } = loadEnv();
  const client = createClient();

  if (command === "serve") {
    await runServe(client, token, guildId);
    return; // serve keeps the process alive
  }

  if (command === "announce") {
    const type = process.argv[3];
    if (type !== "beta" && type !== "rc" && type !== "release") {
      log(
        "Usage: tsx src/index.ts announce <beta|rc|release> [version] [--notes-file <path> | --notes <text>]",
      );
      process.exitCode = 1;
      return;
    }
    const versionArg = process.argv[4];
    const version =
      versionArg && !versionArg.startsWith("--") ? versionArg : readRepoVersion();
    if (!version) {
      log("No version given and backend/VERSION could not be read.");
      process.exitCode = 1;
      return;
    }
    // Optional custom notes override. Betas ship from the dev branch, whose
    // version has no CHANGELOG entry, so `--notes-file <path>` (or inline
    // `--notes "text"`) lets the announcement carry real release notes instead
    // of the generic "See the changelog" fallback. Without either flag it reads
    // the matching CHANGELOG entry as before.
    const notesFileIdx = process.argv.indexOf("--notes-file");
    const notesInlineIdx = process.argv.indexOf("--notes");
    let notes: string | null;
    if (notesFileIdx !== -1 && process.argv[notesFileIdx + 1]) {
      notes = readFileSync(process.argv[notesFileIdx + 1], "utf8").replace(/\s+$/, "");
    } else if (notesInlineIdx !== -1 && process.argv[notesInlineIdx + 1]) {
      notes = process.argv[notesInlineIdx + 1];
    } else {
      const changelog = readRepoChangelog();
      notes = changelog ? extractChangelogEntry(changelog, version) : null;
    }
    await runAnnounce(client, token, guildId, type as AnnounceType, version, notes, dryRun);
    return; // runAnnounce owns login + destroy
  }

  if (command === "read") {
    const channelName = process.argv[3];
    if (!channelName) {
      log("Usage: tsx src/index.ts read <channel-name> [limit]");
      process.exitCode = 1;
      return;
    }
    const limitArg = Number(process.argv[4] ?? "20");
    const limit = Number.isInteger(limitArg) && limitArg > 0 && limitArg <= 100 ? limitArg : 20;
    await runRead(client, token, guildId, channelName, limit);
    return; // runRead owns login + destroy
  }

  if (command === "reply") {
    // Anything with a newline must come from a file — see replyArgs.ts for the
    // incident that rule exists for.
    const input = resolveReplyInput(process.argv);
    if (input.kind === "error") {
      log(input.reason);
      process.exitCode = 1;
      return;
    }
    const message =
      input.kind === "file"
        ? readFileSync(input.path, "utf8").replace(/\s+$/, "")
        : input.message;
    if (!message) {
      log("The message file is empty — nothing to post.");
      process.exitCode = 1;
      return;
    }
    await runReply(client, token, guildId, input.channel, message, dryRun);
    return; // runReply owns login + destroy
  }

  if (command === "setup") {
    client.once("clientReady", async () => {
      try {
        await runSetup(client, guildId, dryRun);
      } catch (err) {
        log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        await client.destroy();
      }
    });
    await client.login(token);
    return;
  }

  log(
    "Usage: tsx src/index.ts <setup|serve|read|announce|reply> [--dry-run] [args]\n" +
      "  setup [--dry-run]              provision the server\n" +
      "  serve                          run the reaction-role listener (unused if no ✈️)\n" +
      "  read <channel> [limit]         print recent messages of a channel\n" +
      "  announce <beta|rc|release> [v] [--notes-file <path> | --notes <text>]\n" +
      "                                post a beta/RC/release announcement\n" +
      "  reply <thread> <message…>      reply in a forum thread (use --file <path> for multi-line)",
  );
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
