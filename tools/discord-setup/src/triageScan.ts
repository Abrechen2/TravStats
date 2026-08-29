// One-off triage scan: enumerate the guild's REAL channels, report anything
// newer than the per-channel watermark, including attachments.
import { ChannelType } from "discord.js";
import { createClient, loadEnv } from "./client";

/**
 * The cutoff is passed in, never stored here. The watermarks live in
 * `roadmap.local.yaml`, which is gitignored because it names real hosts --
 * copying them into this file would make the copy the thing that rots.
 */
const since = process.argv[2];
if (!since || Number.isNaN(Date.parse(since))) {
  console.error("usage: tsx src/triageScan.ts <ISO timestamp>   e.g. 2026-08-20T00:00:00Z");
  process.exit(2);
}
const CUTOFF = Date.parse(since);

async function main(): Promise<void> {
  const { token, guildId } = loadEnv();
  const client = createClient();
  await client.login(token);
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  console.log(`ENUMERATED ${channels.size} channels`);

  for (const [, ch] of channels) {
    if (!ch) continue;
    if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildForum) continue;
    const cutoff = CUTOFF;

    if (ch.type === ChannelType.GuildForum) {
      const active = await ch.threads.fetchActive();
      const archived = await ch.threads.fetchArchived({ limit: 50 });
      const threads = [...active.threads.values(), ...archived.threads.values()];
      for (const t of threads) {
        const msgs = await t.messages.fetch({ limit: 50 });
        const fresh = [...msgs.values()].filter((m) => m.createdTimestamp > cutoff);
        if (fresh.length === 0) continue;
        console.log(`\n### FORUM #${ch.name} / thread "${t.name}" — ${fresh.length} new`);
        for (const m of fresh.reverse()) print(m);
      }
      continue;
    }

    let msgs;
    try {
      msgs = await ch.messages.fetch({ limit: 60 });
    } catch {
      console.log(`(no read access: #${ch.name})`);
      continue;
    }
    const fresh = [...msgs.values()].filter((m) => m.createdTimestamp > cutoff);
    if (fresh.length === 0) {
      const last = [...msgs.values()][0];
      console.log(`#${ch.name}: nothing new (last ${last ? last.createdAt.toISOString() : "—"}, ${msgs.size} msgs)`);
      continue;
    }
    console.log(`\n### #${ch.name} — ${fresh.length} new since ${new Date(cutoff).toISOString()}`);
    for (const m of fresh.reverse()) print(m);
  }
  await client.destroy();
}

function print(m: { createdAt: Date; author: { username: string }; content: string; attachments: Map<string, { url: string; name: string | null }>; embeds: unknown[] }): void {
  console.log(`--- ${m.createdAt.toISOString()} @${m.author.username}`);
  console.log(m.content || "(no text)");
  for (const [, a] of m.attachments) console.log(`  [ATTACHMENT] ${a.name} ${a.url}`);
  if (m.embeds.length > 0) console.log(`  (${m.embeds.length} embed(s))`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
