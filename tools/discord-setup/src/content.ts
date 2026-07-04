import { EmbedBuilder } from "discord.js";

export const RULES_MARKER = "travstats-rules-v1";
export const WELCOME_MARKER = "travstats-welcome-v1";

const RULES_DE = [
  "**1. Sei respektvoll** — keine Beleidigungen, Belästigung oder Hassrede.",
  "**2. Schütze private Daten** — keine fremden Buchungsdaten, PNRs, Namen, Adressen oder API-Keys in Screenshots/Logs. Schwärze persönliche Infos.",
  "**3. Sprache** — DE und EN. Andere Sprachen gern in privaten Threads.",
  "**4. Poste im richtigen Channel** — Bugs zuerst auf GitHub melden.",
  "**5. Kein Spam / keine aufdringliche Eigenwerbung** — offensichtliche Ads werden entfernt.",
  "**6. Keine sensiblen Daten teilen** — keine API-Keys, IPs oder Zugangsdaten in geposteten Logs.",
  "**7. Mods haben das letzte Wort** — halte dich dran, bei Uneinigkeit den Maintainer per DM kontaktieren.",
].join("\n");

const RULES_EN = [
  "**1. Be respectful** — no insults, harassment, or hate speech.",
  "**2. Protect private data** — no third-party booking data, PNRs, names, addresses or API keys in screenshots/logs. Redact personal info.",
  "**3. Language** — DE and EN. Other languages welcome in private threads.",
  "**4. Post in the right channel** — file bugs on GitHub first.",
  "**5. No spam / heavy self-promotion** — blatant ads are removed.",
  "**6. No sensitive data** — no API keys, IPs or credentials in posted logs.",
  "**7. Mods have the final say** — comply and DM the maintainer if you disagree.",
].join("\n");

export function buildRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📋 Serverregeln / Server Rules")
    .setColor(0xf0a947)
    .addFields(
      { name: "Regeln (DE)", value: RULES_DE },
      { name: "Eskalation", value: "Warnung → Timeout → Kick → Ban." },
      { name: "Beta", value: "Reagiere mit ✈️, um die **Beta-Tester**-Channels freizuschalten." },
      { name: "Rules (EN)", value: RULES_EN },
      { name: "Escalation", value: "Warning → Timeout → Kick → Ban. React with ✈️ to unlock the Beta-Tester channels." },
    )
    .setFooter({ text: RULES_MARKER });
}

export function buildWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Willkommen bei TravStats / Welcome to TravStats")
    .setColor(0xf0a947)
    .setDescription(
      [
        "**TravStats** ist ein selbst-gehostetes Reise-Logbuch (Flights, Cruises & mehr).",
        "TravStats is a self-hosted travel logbook (flights, cruises & more).",
        "",
        "🔗 GitHub: https://github.com/abrechen2/travstats",
        "📖 Docs: https://travstats.de/docs/",
        "",
        "➡️ Lies die Regeln in #rules und frag bei Setup-Fragen in **#install-help**.",
        "➡️ Read the rules in #rules and ask setup questions in **#install-help**.",
      ].join("\n"),
    )
    .setFooter({ text: WELCOME_MARKER });
}
