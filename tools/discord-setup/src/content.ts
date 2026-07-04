import { EmbedBuilder } from "discord.js";

export const RULES_MARKER = "travstats-rules-v1";
export const WELCOME_MARKER = "travstats-welcome-v1";

const RULES = [
  "**1. Be respectful** — no insults, harassment, or hate speech.",
  "**2. Protect private data** — no third-party booking data, PNRs, names, addresses or API keys in screenshots/logs. Redact personal info.",
  "**3. Language** — English preferred. Other languages welcome in private threads.",
  "**4. Post in the right channel** — file bugs on GitHub first.",
  "**5. No spam / heavy self-promotion** — blatant ads are removed.",
  "**6. No sensitive data** — no API keys, IPs or credentials in posted logs.",
  "**7. Mods have the final say** — comply and DM the maintainer if you disagree.",
].join("\n");

export function buildRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📋 Server Rules")
    .setColor(0xf0a947)
    .addFields(
      { name: "Rules", value: RULES },
      { name: "Escalation", value: "Warning → Timeout → Kick → Ban." },
    )
    .setFooter({ text: RULES_MARKER });
}

export function buildWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Welcome to TravStats")
    .setColor(0xf0a947)
    .setDescription(
      [
        "**TravStats** is a self-hosted travel logbook (flights, cruises & more).",
        "",
        "🔗 GitHub: https://github.com/abrechen2/travstats",
        "📖 Docs: https://travstats.de/docs/",
        "",
        "➡️ Read the rules in #rules and ask setup questions in **#install-help**.",
      ].join("\n"),
    )
    .setFooter({ text: WELCOME_MARKER });
}
