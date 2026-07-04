import { Client, EmbedBuilder } from "discord.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { log } from "./log.js";

export type AnnounceType = "rc" | "release";

const REPO_URL = "https://github.com/abrechen2/travstats";
const RC_COLOR = 0x7bc47f;
const RELEASE_COLOR = 0xf0a947;
const MAX_NOTES = 3500; // Discord embed description caps at 4096

const CHANNEL_FOR: Record<AnnounceType, string> = {
  rc: "beta-channel",
  release: "announcements",
};

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");

export function readRepoVersion(): string | null {
  const path = join(REPO_ROOT, "backend", "VERSION");
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}

export function readRepoChangelog(): string | null {
  const path = join(REPO_ROOT, "CHANGELOG.md");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function channelForType(type: AnnounceType): string {
  return CHANNEL_FOR[type];
}

export function buildAnnounceEmbed(
  type: AnnounceType,
  version: string,
  notes: string | null,
): EmbedBuilder {
  const isRc = type === "rc";
  const intro = isRc
    ? "A new release candidate is live for testing. Please try it and report issues in **#beta-feedback**."
    : "A new version is out.";
  const body = notes && notes.trim().length > 0 ? notes.trim() : "See the changelog for details.";
  const truncated = body.length > MAX_NOTES ? `${body.slice(0, MAX_NOTES)}\n…` : body;
  const releaseUrl = `${REPO_URL}/releases/tag/v${version}`;

  return new EmbedBuilder()
    .setTitle(isRc ? `🧪 Release Candidate ${version}` : `🚀 TravStats ${version} released`)
    .setColor(isRc ? RC_COLOR : RELEASE_COLOR)
    .setDescription(`${intro}\n\n${truncated}\n\n🔗 ${releaseUrl}`)
    .setFooter({ text: `travstats-release-${version}` });
}

/**
 * Post a release/RC announcement embed to the appropriate channel, then
 * disconnect. One-shot, no persistent connection.
 */
export async function runAnnounce(
  client: Client,
  token: string,
  guildId: string,
  type: AnnounceType,
  version: string,
  notes: string | null,
): Promise<void> {
  const channelName = channelForType(type);
  client.once("clientReady", async () => {
    try {
      const guild = await (await client.guilds.fetch(guildId)).fetch();
      await guild.channels.fetch();
      const channel = guild.channels.cache.find((c) => c.name === channelName);
      if (!channel || !channel.isTextBased()) {
        log(`Target channel #${channelName} not found or not a text channel.`);
        process.exitCode = 1;
        return;
      }
      await channel.send({ embeds: [buildAnnounceEmbed(type, version, notes)] });
      log(`announced ${type} ${version} in #${channelName}`);
    } catch (err) {
      log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await client.destroy();
    }
  });

  await client.login(token);
}
