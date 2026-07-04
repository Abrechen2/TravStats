import { Client, ForumChannel } from "discord.js";
import { log } from "./log.js";

const MAX_FORUM_THREADS = 15;

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
 * Read a forum channel: forums hold their posts as threads, so enumerate the
 * threads (active + archived, newest first, capped) and print each thread's
 * messages up to perThreadLimit.
 */
async function readForum(forum: ForumChannel, perThreadLimit: number): Promise<void> {
  const active = await forum.threads.fetchActive();
  const archived = await forum.threads.fetchArchived().catch(() => null);
  const threads = [
    ...active.threads.values(),
    ...(archived ? [...archived.threads.values()] : []),
  ];
  if (threads.length === 0) {
    log(`#${forum.name} has no posts yet.`);
    return;
  }

  const shown = threads.slice(0, MAX_FORUM_THREADS);
  const suffix = threads.length > MAX_FORUM_THREADS ? ` of ${threads.length}` : "";
  log(`=== ${shown.length}${suffix} post(s) in forum #${forum.name} ===`);
  for (const thread of shown) {
    log(`\n--- post: "${thread.name}" ---`);
    const messages = await thread.messages.fetch({ limit: perThreadLimit });
    for (const message of [...messages.values()].reverse()) {
      log(formatMessage(message.author.tag, message.createdAt.toISOString(), message.content));
    }
  }
}

/**
 * On-demand reader: log in, fetch the most recent messages of one channel
 * (text channel by name, or all posts of a forum channel) in the target
 * guild, print them oldest-first, then disconnect. Not a persistent
 * connection — one shot per invocation.
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
      if (channel instanceof ForumChannel) {
        await readForum(channel, limit);
        return;
      }
      if (!channel.isTextBased()) {
        log(`#${channelName} is not a readable text or forum channel.`);
        return;
      }

      const messages = await channel.messages.fetch({ limit });
      if (messages.size === 0) {
        log(`#${channelName} has no messages yet.`);
        return;
      }

      log(`=== last ${messages.size} message(s) in #${channelName} (oldest first) ===`);
      for (const message of [...messages.values()].reverse()) {
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
