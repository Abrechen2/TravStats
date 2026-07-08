import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config as loadDotenv } from "dotenv";

loadDotenv();

export function loadEnv(): { token: string; guildId: string } {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is missing — copy .env.example to .env and fill it in.");
  if (!guildId) throw new Error("DISCORD_GUILD_ID is missing — copy .env.example to .env and fill it in.");
  return { token, guildId };
}

export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
}
