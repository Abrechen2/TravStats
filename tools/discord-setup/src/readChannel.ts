import { Client } from "discord.js";
import { log } from "./log.js";

/**
 * Format a single fetched message as one readable line. Falls back to a
 * placeholder when the content is empty (which happens if the bot lacks the
 * Message Content intent and the message does not mention it).
 */
export function formatMessage(authorTag: string, iso: string, content: string): string {
  const body = content.trim().length > 0 ? content : "(no text content)";
  return `[${iso}] ${authorTag}: ${body}`;
}

/**
 * On-demand reader: log in, fetch the most recent messages of one text
 * channel (by name) in the target guild, print them oldest-first, then
 * disconnect. Not a persistent connection — one shot per invocation.
 */
export async function runRead(
  client: Client,
  token: string,
  guildId: string,
  channelName: string,
  limit: number,
): Promise<void> {
  client.once("clientReady", async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const full = await guild.fetch();
      await full.channels.fetch();

      const channel = full.channels.cache.find((c) => c.name === channelName);
      if (!channel) {
        log(`Channel #${channelName} not found in the guild.`);
        return;
      }
      if (!channel.isTextBased()) {
        log(
          `#${channelName} is not a readable text channel (forums hold their posts in threads, not directly).`,
        );
        return;
      }

      const messages = await channel.messages.fetch({ limit });
      if (messages.size === 0) {
        log(`#${channelName} has no messages yet.`);
        return;
      }

      log(`=== last ${messages.size} message(s) in #${channelName} (oldest first) ===`);
      const ordered = [...messages.values()].reverse();
      for (const message of ordered) {
        log(formatMessage(message.author.tag, message.createdAt.toISOString(), message.content));
      }
    } catch (err) {
      log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await client.destroy();
    }
  });

  await client.login(token);
}
