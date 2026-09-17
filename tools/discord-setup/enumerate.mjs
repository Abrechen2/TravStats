// One-off: enumerate the guild's REAL channels and dump everything newer than
// each channel's watermark. Never trust config.ts — see
// feedback_discord_triage_enumerate_channels.
import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

const WATERMARKS = {
  "dev-talk": "2026-08-26T20:18:00Z",
  "beta-channel": "2026-08-25T00:00:00Z",
  general: "2026-08-29T09:40:00Z",
  "release-candidate": "2026-08-29T09:40:00Z",
  "hotel-poi-domain": "2026-08-07T09:29:00Z",
};
const DEFAULT_SINCE = "2026-08-01T00:00:00Z";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function fmt(m) {
  const att = [...m.attachments.values()].map((a) => `${a.name} <${a.url}>`);
  const emb = m.embeds.map((e) => `[embed] ${e.title ?? ""}`.trim());
  const body = (m.content || "").replace(/\n/g, "\n      ").trim();
  return [
    `    · ${m.createdAt.toISOString()}  ${m.author.username}${m.author.bot ? " (bot)" : ""}`,
    body ? `      ${body}` : "      (kein Text)",
    att.length ? `      ANHANG: ${att.join(" | ")}` : null,
    emb.length ? `      ${emb.join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function dump(ch, label, sinceIso) {
  const since = new Date(sinceIso).getTime();
  let msgs;
  try {
    msgs = await ch.messages.fetch({ limit: 100 });
  } catch {
    return 0;
  }
  const fresh = [...msgs.values()]
    .filter((m) => m.createdTimestamp > since)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  if (fresh.length) {
    console.log(`\n  ${label}  — ${fresh.length} neu seit ${sinceIso}`);
    for (const m of fresh) console.log(fmt(m));
  }
  return fresh.length;
}

client.once("clientReady", async () => {
  const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const channels = await guild.channels.fetch(); // source of truth
  console.log(`GUILD: ${guild.name} — ${channels.size} Kanäle insgesamt\n`);

  let total = 0;
  const known = new Set(Object.keys(WATERMARKS));
  const seen = [];

  for (const ch of [...channels.values()]
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const kind = ChannelType[ch.type];
    const hasMark = known.has(ch.name);
    seen.push(`${ch.name} (${kind})${hasMark ? "" : "  ← KEINE Wasserlinie"}`);
    const since = WATERMARKS[ch.name] ?? DEFAULT_SINCE;

    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
      total += await dump(ch, `#${ch.name}`, since);
    } else if (ch.type === ChannelType.GuildForum) {
      const active = await ch.threads.fetchActive().catch(() => null);
      const archived = await ch.threads.fetchArchived({ limit: 50 }).catch(() => null);
      const threads = [
        ...(active?.threads?.values() ?? []),
        ...(archived?.threads?.values() ?? []),
      ];
      for (const t of threads) total += await dump(t, `#${ch.name} › ${t.name}`, since);
    }
  }

  console.log("\n\n=== ALLE KANÄLE ===");
  for (const s of seen) console.log("  " + s);
  console.log(`\n=== SUMME NEUE NACHRICHTEN: ${total} ===`);
  await client.destroy();
});

client.login(process.env.DISCORD_BOT_TOKEN);
