import { Guild, TextChannel, ChannelType } from "discord.js";
import { buildRulesEmbed, buildWelcomeEmbed, RULES_MARKER, WELCOME_MARKER } from "./content.js";
import { log, dryRunLog } from "./log.js";

function findTextChannel(guild: Guild, name: string): TextChannel | null {
  const ch = guild.channels.cache.find(
    (c) => c.name === name && c.type === ChannelType.GuildText,
  );
  return ch instanceof TextChannel ? ch : null;
}

export async function postRulesAndWelcome(
  guild: Guild,
  rulesChannelId: string | null,
  dryRun: boolean,
): Promise<string | null> {
  let rules: TextChannel | null;
  if (rulesChannelId) {
    const raw = await guild.channels.fetch(rulesChannelId);
    rules = raw instanceof TextChannel ? raw : null;
  } else {
    rules = findTextChannel(guild, "rules");
  }
  const welcome = findTextChannel(guild, "welcome");

  if (dryRun) {
    dryRunLog("post/refresh rules embed, post welcome embed");
    return null;
  }
  if (!rules) {
    log("WARNING: #rules channel not found; skipping rules post.");
    return null;
  }

  const recent = await rules.messages.fetch({ limit: 50 });
  const mine = recent.find(
    (m) => m.author.id === guild.client.user?.id &&
      m.embeds.some((e) => e.footer?.text === RULES_MARKER),
  );

  let messageId: string;
  if (mine) {
    await mine.edit({ embeds: [buildRulesEmbed()] });
    messageId = mine.id;
    log("updated existing rules message");
  } else {
    const sent = await rules.send({ embeds: [buildRulesEmbed()] });
    await sent.pin("TravStats rules");
    messageId = sent.id;
    log("posted rules message");
  }

  if (welcome) {
    const welcomeRecent = await welcome.messages.fetch({ limit: 20 });
    const hasWelcome = welcomeRecent.some(
      (m) => m.author.id === guild.client.user?.id &&
        m.embeds.some((e) => e.footer?.text === WELCOME_MARKER),
    );
    if (!hasWelcome) await welcome.send({ embeds: [buildWelcomeEmbed()] });
  }

  return messageId;
}
