/**
 * One-off: append a line to the description of the bot's OWN last embed in a
 * channel.
 *
 * The rc.10 announcement went out without the image tag, which every earlier
 * RC announcement carried — it is the one line a tester acts on. Editing the
 * existing message is better than a second post: the readers who already saw
 * it get the missing detail in place, and the channel keeps one entry per RC.
 */
import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from "discord.js";
import { readFileSync } from "node:fs";

function env(name: string): string {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim();
  }
  throw new Error(`missing ${name}`);
}

const channelName = process.argv[2];
const appendPath = process.argv[3];
const apply = process.argv.includes("--apply");
if (!channelName || !appendPath) {
  throw new Error("usage: tsx src/amendEmbed.ts <channel> <file-with-text> [--apply]");
}
const addition = readFileSync(appendPath, "utf8").replace(/\s+$/, "");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
await client.login(env("DISCORD_BOT_TOKEN"));
const guild = await client.guilds.fetch(env("DISCORD_GUILD_ID"));
const channels = await guild.channels.fetch();
const channel = channels.find((c) => c?.name === channelName) as TextChannel | undefined;
if (!channel) throw new Error(`channel #${channelName} not found`);

const messages = await channel.messages.fetch({ limit: 10 });
const mine = [...messages.values()].find(
  (m) => m.author.id === client.user?.id && m.embeds.length > 0
);
if (!mine) throw new Error("no own embed message found in the last 10");

const old = mine.embeds[0];
const merged = EmbedBuilder.from(old).setDescription(`${old.description ?? ""}\n\n${addition}`);

if (!apply) {
  console.log("=== DRY RUN — nothing changed ===");
  console.log(`message: ${mine.id} (${mine.createdAt.toISOString()})`);
  console.log(`title:   ${old.title}`);
  console.log("--- new tail ---");
  console.log(addition);
} else {
  await mine.edit({ embeds: [merged] });
  console.log(`amended ${mine.id} in #${channelName}`);
}
await client.destroy();
