import { Client, EmbedBuilder } from "discord.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { log } from "./log.js";

// The three announce lanes mirror the release tiers (see docs/RELEASE_WORKFLOW.md):
//   beta    — forward dev line, `-beta.N` builds on the Beta server (CT106)
//   rc      — prod candidates, `-rc.N` validated on the RC Server (CT107)
//   release — final `X.Y.Z`, promoted to prod (CT100)
export type AnnounceType = "beta" | "rc" | "release";

const REPO_URL = "https://github.com/abrechen2/travstats";
const MAX_NOTES = 3500; // Discord embed description caps at 4096

interface AnnounceStyle {
  readonly channel: string;
  readonly color: number;
  readonly title: (v: string) => string;
  readonly intro: string;
}

const STYLE: Record<AnnounceType, AnnounceStyle> = {
  beta: {
    channel: "beta-channel",
    color: 0x4aa6b0,
    title: (v) => `🧪 Beta ${v}`,
    intro:
      "A new beta build from the forward dev line is live on the Beta server. " +
      "Try it and share feedback in **#beta-feedback**.",
  },
  rc: {
    channel: "release-candidate",
    color: 0x7bc47f,
    title: (v) => `🚦 Release Candidate ${v}`,
    // Says what an RC IS, not what was done to it. The old wording claimed
    // every RC had been "validated against prod data"; staging a prod clone is
    // a per-round decision, and since 2.6.0-rc.13 it has deliberately not run.
    // A template must not make a claim only some releases can honour.
    intro:
      "A release candidate is the build lined up to ship — the final tags are cut " +
      "from this exact image, unchanged. Final testing — report anything in " +
      "**#beta-feedback**.",
  },
  release: {
    channel: "announcements",
    color: 0xf0a947,
    title: (v) => `🚀 TravStats ${v} released`,
    intro: "A new version is out.",
  },
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
  return STYLE[type].channel;
}

export function buildAnnounceEmbed(
  type: AnnounceType,
  version: string,
  notes: string | null,
): EmbedBuilder {
  const style = STYLE[type];
  const body = notes && notes.trim().length > 0 ? notes.trim() : "See the changelog for details.";
  const truncated = body.length > MAX_NOTES ? `${body.slice(0, MAX_NOTES)}\n…` : body;
  const releaseUrl = `${REPO_URL}/releases/tag/v${version}`;

  return new EmbedBuilder()
    .setTitle(style.title(version))
    .setColor(style.color)
    .setDescription(`${style.intro}\n\n${truncated}\n\n🔗 ${releaseUrl}`)
    .setFooter({ text: `travstats-release-${version}` });
}

/**
 * Post a release/RC announcement embed to the appropriate channel, then
 * disconnect. One-shot, no persistent connection.
 *
 * The returned promise settles only once the work is actually finished: it
 * resolves from inside the `finally`, after `client.destroy()`, not when
 * `client.login()` resolves. discord.js's `login()` resolves on the raw
 * gateway READY dispatch, which fires BEFORE the `clientReady` event this
 * function's work runs on — awaiting `login()` alone would return before the
 * announcement has even been posted. A `login()` rejection (e.g. a bad token)
 * rejects this promise directly, since `clientReady` never fires in that
 * case. Not applicable to the `dryRun` path below, which returns before
 * `login()` is ever called.
 */
export async function runAnnounce(
  client: Client,
  token: string,
  guildId: string,
  type: AnnounceType,
  version: string,
  notes: string | null,
  dryRun = false,
): Promise<void> {
  const channelName = channelForType(type);

  // Bail out before `login()` — a dry run must not open a gateway connection,
  // let alone reach `channel.send`. Returning here is what makes the flag
  // honest: `announce --dry-run` used to parse the flag, ignore it, post the
  // embed for real, and still print "announced …".
  if (dryRun) {
    const embed = buildAnnounceEmbed(type, version, notes).toJSON();
    log("=== DRY RUN — nothing was posted ===");
    log(`channel: #${channelName}`);
    log(`title:   ${embed.title ?? "(none)"}`);
    log("--- description ---");
    log(embed.description ?? "(none)");
    return;
  }

  return new Promise<void>((resolve, reject) => {
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
        resolve();
      }
    });

    client.login(token).catch((err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
