import {
  Client,
  Guild,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from "discord.js";
import { readState } from "./state.js";
import { BETA_REACTION } from "./config.js";
import { log } from "./log.js";

const BETA_ROLE = "Beta-Tester";

async function toggleBeta(
  guild: Guild,
  userId: string,
  add: boolean,
): Promise<void> {
  const role = guild.roles.cache.find((r) => r.name === BETA_ROLE);
  if (!role) {
    log(`WARNING: ${BETA_ROLE} role not found — run setup first.`);
    return;
  }
  const member = await guild.members.fetch(userId);
  if (add) {
    await member.roles.add(role, "beta ✈️ opt-in");
    log(`+ ${BETA_ROLE} → ${member.user.tag}`);
  } else {
    await member.roles.remove(role, "beta ✈️ opt-out");
    log(`- ${BETA_ROLE} → ${member.user.tag}`);
  }
}

export async function runServe(client: Client, token: string, guildId: string): Promise<void> {
  const state = readState().find((s) => s.guildId === guildId);
  const rulesMessageId = state?.rulesMessageId ?? null;
  if (!rulesMessageId) {
    throw new Error("No rules message id in .state.json — run `npm run setup` first.");
  }

  async function handle(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    add: boolean,
  ): Promise<void> {
    try {
      if (user.bot) return;
      const full = reaction.partial ? await reaction.fetch() : reaction;
      if (full.message.id !== rulesMessageId) return;
      if (full.emoji.name !== BETA_REACTION) return;
      const guild = full.message.guild;
      if (!guild) return;
      await toggleBeta(guild, user.id, add);
    } catch (err) {
      log(`reaction handler error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  client.on("messageReactionAdd", (r, u) => void handle(r, u, true));
  client.on("messageReactionRemove", (r, u) => void handle(r, u, false));
  client.once("clientReady", () => log(`serve mode ready — watching rules message ${rulesMessageId} for ✈️`));

  await client.login(token);
}
