import { escapeHtml, type ReminderLang } from "./reminderFormat";

/**
 * The one shell every TravStats mail renders through — reminders for all four
 * domains and the account mails (password reset, invitation) alike
 * (forgejo#189: "Design und Informationsgehalt der Mails überarbeiten").
 *
 * A mail is DATA first: a builder returns a `MailContent` of plain strings,
 * and the two renderers here turn the same content into HTML and into the
 * plain-text alternative. Two things follow from that, and both are the
 * point:
 *
 * - **Escaping has exactly one home.** Builders never escape and never write
 *   markup; `renderMailHtml` escapes every string it places. Before this,
 *   each builder escaped by hand and the account mails did not escape at all
 *   (a username went into the markup raw).
 * - **The text part cannot drift from the HTML part.** Both come from the same
 *   blocks, so a fact added to one is in the other.
 *
 * What a mail client forces on the markup: tables for layout and inline styles
 * for everything that must hold (Gmail drops `<style>` in some views, Outlook
 * renders with Word), a system font stack (no web fonts), no images at all.
 *
 * Light and dark: the inline styles are the LIGHT rendering — the app's
 * `paper` tokens — because that is the one every client can show. The app's
 * own dark surface is offered through `prefers-color-scheme` to the clients
 * that honour it (Apple Mail, iOS Mail, Outlook for Mac); a client that drops
 * the `<style>` block simply stays light. A dark-by-default mail was not
 * chosen: Gmail and Outlook partially invert those and produce a third,
 * unreadable scheme. The header band and the button keep the accent colour
 * with dark text in both schemes.
 */

/** design/tokens.json `color.*` — a test ties these to the token file. */
export const MAIL_PALETTE = {
  paper: "#f5f1e8",
  paperText: "#2a2419",
  bg: "#0b0d10",
  surface: "#14181d",
  surface2: "#101317",
  tile: "#1a1f26",
  text: "#e7e3dc",
  textBright: "#f4ece0",
  accent: "#f0a947",
  accentText: "#0b0d10",
} as const;

/** Mail-only shades with no token: opaque stand-ins for the app's translucent `muted` / `border`. */
const LIGHT = {
  card: "#ffffff",
  muted: "#6b6252",
  rule: "#e6dfd0",
  foot: "#faf7f0",
  code: "#f1ece0",
};
const DARK = { muted: "#a5a29c", rule: "#2a2f36" };

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export interface MailFact {
  label: string;
  value: string;
  /** Codes and measured values are set in mono, as in the app. */
  mono?: boolean;
}

export interface MailRouteEnd {
  /** The big line: an airport code, or a station name. */
  primary: string;
  /** The airport's name under its code; left out when there is none. */
  secondary?: string | null;
  /** The already-formatted local time at this end; left out when unknown. */
  time?: string | null;
}

export type MailBlock =
  | { kind: "text"; text: string; muted?: boolean }
  | { kind: "subheading"; text: string }
  | { kind: "route"; from: MailRouteEnd; to: MailRouteEnd }
  | { kind: "facts"; rows: MailFact[] }
  | { kind: "code"; value: string }
  | { kind: "button"; label: string; url: string }
  /** A labelled plain link — the fallback for a button a client refuses to draw. */
  | { kind: "link"; label: string; url: string }
  | { kind: "divider" };

/** Footer copy: plain text with inline links. */
export type MailFooterPart = string | { label: string; url: string };

export interface MailContent {
  lang: ReminderLang;
  subject: string;
  /** Hidden preview text most mail clients show next to the subject. */
  preheader: string;
  /** Header band colour — a domain's registry colour, or the app accent. */
  accent: string;
  /** Small caps line above the heading, e.g. "TravStats · Flug". */
  eyebrow: string;
  heading: string;
  blocks: MailBlock[];
  footer: MailFooterPart[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const DARK_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ts-canvas { background: ${MAIL_PALETTE.bg} !important; }
    .ts-card { background: ${MAIL_PALETTE.surface} !important; border-color: ${DARK.rule} !important; }
    .ts-text { color: ${MAIL_PALETTE.text} !important; }
    .ts-bright { color: ${MAIL_PALETTE.textBright} !important; }
    .ts-muted { color: ${DARK.muted} !important; }
    .ts-rule { border-color: ${DARK.rule} !important; }
    .ts-foot { background: ${MAIL_PALETTE.surface2} !important; border-color: ${DARK.rule} !important; }
    .ts-code { background: ${MAIL_PALETTE.tile} !important; color: ${MAIL_PALETTE.textBright} !important; }
  }`;

const e = escapeHtml;

function routeEndHtml(end: MailRouteEnd, align: "left" | "right"): string {
  const secondary = end.secondary
    ? `<div class="ts-text" style="font-size:14px;line-height:1.4;color:${MAIL_PALETTE.paperText};padding-top:2px;">${e(end.secondary)}</div>`
    : "";
  const time = end.time
    ? `<div class="ts-muted" style="font-size:13px;line-height:1.4;color:${LIGHT.muted};padding-top:6px;">${e(end.time)}</div>`
    : "";
  return (
    `<td width="45%" valign="top" align="${align}" style="text-align:${align};">` +
    `<div class="ts-bright" style="font-size:24px;line-height:1.2;font-weight:bold;color:${MAIL_PALETTE.paperText};">${e(end.primary)}</div>` +
    `${secondary}${time}</td>`
  );
}

function factsHtml(rows: MailFact[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map((row, index) => {
      const rule = index === 0 ? "" : `border-top:1px solid ${LIGHT.rule};`;
      const font = row.mono ? `font-family:${MONO_STACK};` : "";
      return (
        `<tr>` +
        `<td class="ts-muted ts-rule" valign="top" style="${rule}padding:9px 16px 9px 0;font-size:11px;line-height:1.6;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;color:${LIGHT.muted};">${e(row.label)}</td>` +
        `<td class="ts-text ts-rule" valign="top" style="${rule}padding:8px 0;font-size:15px;line-height:1.45;${font}color:${MAIL_PALETTE.paperText};">${e(row.value)}</td>` +
        `</tr>`
      );
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${body}</table>`;
}

function blockHtml(block: MailBlock, accent: string): string {
  switch (block.kind) {
    case "text":
      return block.muted
        ? `<p class="ts-muted" style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${LIGHT.muted};">${e(block.text)}</p>`
        : `<p class="ts-text" style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${MAIL_PALETTE.paperText};">${e(block.text)}</p>`;
    case "subheading":
      return `<p class="ts-bright" style="margin:0 0 8px;font-size:16px;line-height:1.3;font-weight:bold;color:${MAIL_PALETTE.paperText};">${e(block.text)}</p>`;
    case "route":
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>` +
        routeEndHtml(block.from, "left") +
        `<td width="10%" valign="top" align="center" class="ts-muted" style="font-size:22px;line-height:1.3;color:${LIGHT.muted};">&rarr;</td>` +
        routeEndHtml(block.to, "right") +
        `</tr></table>`
      );
    case "facts":
      return factsHtml(block.rows);
    case "code":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>` +
        `<td class="ts-code" bgcolor="${LIGHT.code}" style="background:${LIGHT.code};border-radius:8px;padding:12px 16px;font-family:${MONO_STACK};font-size:18px;letter-spacing:1px;color:${MAIL_PALETTE.paperText};">${e(block.value)}</td>` +
        `</tr></table>`
      );
    case "button":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr>` +
        `<td bgcolor="${accent}" style="background:${accent};border-radius:8px;">` +
        `<a href="${e(block.url)}" style="display:inline-block;padding:11px 22px;font-size:15px;font-weight:bold;color:${MAIL_PALETTE.accentText};text-decoration:none;">${e(block.label)}</a>` +
        `</td></tr></table>`
      );
    case "link":
      return (
        `<p class="ts-muted" style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${LIGHT.muted};word-break:break-all;">${e(block.label)} ` +
        `<a class="ts-muted" href="${e(block.url)}" style="color:${LIGHT.muted};text-decoration:underline;">${e(block.url)}</a></p>`
      );
    case "divider":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ts-rule" style="border-top:1px solid ${LIGHT.rule};font-size:0;line-height:0;padding:0 0 18px;">&nbsp;</td></tr></table>`;
  }
}

/** The HTML part. Every string of `content` is escaped here — builders pass plain text. */
export function renderMailHtml(content: MailContent): string {
  const accent = HEX.test(content.accent) ? content.accent : MAIL_PALETTE.accent;
  const blocks = content.blocks.map((block) => blockHtml(block, accent)).join("\n");
  const footer = content.footer
    .map((part) =>
      typeof part === "string"
        ? e(part)
        : `<a class="ts-muted" href="${e(part.url)}" style="color:${LIGHT.muted};text-decoration:underline;">${e(part.label)}</a>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${content.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(content.subject)}</title>
<style>${DARK_CSS}
</style>
</head>
<body class="ts-canvas" style="margin:0;padding:0;background:${MAIL_PALETTE.paper};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${MAIL_PALETTE.paper};">${e(content.preheader)}</div>
<table role="presentation" class="ts-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MAIL_PALETTE.paper}" style="background:${MAIL_PALETTE.paper};font-family:${FONT_STACK};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="ts-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT.card}" style="width:100%;max-width:600px;background:${LIGHT.card};border:1px solid ${LIGHT.rule};border-radius:14px;border-collapse:separate;overflow:hidden;">
<tr><td bgcolor="${accent}" style="background:${accent};padding:20px 28px;border-radius:13px 13px 0 0;">
<div style="font-size:11px;line-height:1.4;font-weight:bold;letter-spacing:0.1em;text-transform:uppercase;color:${MAIL_PALETTE.accentText};">${e(content.eyebrow)}</div>
<h1 style="margin:6px 0 0;font-size:22px;line-height:1.3;font-weight:bold;color:${MAIL_PALETTE.accentText};">${e(content.heading)}</h1>
</td></tr>
<tr><td style="padding:26px 28px 10px;">
${blocks}
</td></tr>
<tr><td class="ts-foot ts-muted" bgcolor="${LIGHT.foot}" style="background:${LIGHT.foot};border-top:1px solid ${LIGHT.rule};border-radius:0 0 13px 13px;padding:16px 28px;font-size:12px;line-height:1.5;color:${LIGHT.muted};">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function routeEndText(end: MailRouteEnd): string {
  const place = end.secondary ? `${end.primary} (${end.secondary})` : end.primary;
  return end.time ? `${place} — ${end.time}` : place;
}

function blockText(block: MailBlock): string | null {
  switch (block.kind) {
    case "text":
    case "subheading":
      return block.text;
    case "route":
      return `${routeEndText(block.from)}\n→ ${routeEndText(block.to)}`;
    case "facts":
      return block.rows.length === 0
        ? null
        : block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "code":
      return `    ${block.value}`;
    case "button":
      return `${block.label}: ${block.url}`;
    case "link":
      return `${block.label} ${block.url}`;
    case "divider":
      return "----------------------------------------";
  }
}

/**
 * The plain-text alternative: the same blocks, in the same order, with every
 * fact and every link the HTML part carries. Nothing is escaped — this part
 * is never read as markup.
 */
export function renderMailText(content: MailContent): string {
  const blocks = content.blocks.map(blockText).filter((text): text is string => text !== null);
  const footer = content.footer
    .map((part) => (typeof part === "string" ? part : `${part.label} (${part.url})`))
    .join("");
  return [content.eyebrow.toUpperCase(), content.heading, ...blocks, `-- \n${footer}`]
    .join("\n\n")
    .concat("\n");
}
