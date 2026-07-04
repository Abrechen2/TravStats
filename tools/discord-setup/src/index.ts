import { Client } from "discord.js";
import { createClient, loadEnv } from "./client.js";
import { ensureRoles } from "./roles.js";
import { ensureStructure } from "./guildStructure.js";
import { postRulesAndWelcome } from "./rulesMessage.js";
import { writeState } from "./state.js";
import { runServe } from "./reactionRole.js";
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

  log("Usage: tsx src/index.ts <setup|serve> [--dry-run]");
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
