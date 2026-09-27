import type { ReminderLang } from "./reminderFormat";

/**
 * The one branded shell every reminder email (flight, cruise, rail, lodging)
 * renders through — Alex's low-priority note ("Design und Informationsgehalt
 * der Mails überarbeiten, erweitern auf die anderen Domänen") and the owner's
 * "was schönes mit mehr infos und alle Domains", 2026-09-27.
 *
 * Light background only: email clients do not reliably honour
 * `prefers-color-scheme`, and web fonts are unreliable in a mail client, so
 * this is inline styles + a system font stack, the same constraint the
 * existing password-reset/invitation emails already work under.
 *
 * Colours are `design/tokens.json` `domainColor.*` (flight, cruise, rail) —
 * `lodging` reuses `domainColor.hotel`, the closest existing token; there is
 * no dedicated "hotel reminder" domain colour in the design system yet.
 */

export type ReminderDomain = "flight" | "cruise" | "rail" | "lodging";

export const REMINDER_DOMAIN_COLORS: Record<ReminderDomain, string> = {
  flight: "#f0a947",
  cruise: "#4aa6b0",
  rail: "#a597e8",
  lodging: "#5ec2b2",
};

export interface ReminderShellOptions {
  lang: ReminderLang;
  domain: ReminderDomain;
  /** Hidden preview text most mail clients show next to the subject. */
  preheader: string;
  /** The heading inside the coloured header bar — plain text, escaped here. */
  heading: string;
  /** Already-built, already-escaped inner HTML (the domain builder's content). */
  bodyHtml: string;
  /** The entity's (or its trip's) detail page; the button is left out when null. */
  ctaUrl: string | null;
  ctaLabel: string;
  /** `${frontendUrl}/settings/notifications` — where the toggle for this reminder lives. */
  settingsUrl: string;
}

const FOOTER_TEXT: Record<ReminderLang, (settingsUrl: string) => string> = {
  de: (settingsUrl) =>
    `Diese Erinnerung lässt sich unter <a href="${settingsUrl}" style="color:#6b7280;text-decoration:underline;">Einstellungen → Benachrichtigungen</a> abschalten.`,
  en: (settingsUrl) =>
    `You can turn this reminder off under <a href="${settingsUrl}" style="color:#6b7280;text-decoration:underline;">Settings → Notifications</a>.`,
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Renders the branded shell around a domain reminder's already-built body HTML. */
export function renderReminderShell(opts: ReminderShellOptions): string {
  const color = REMINDER_DOMAIN_COLORS[opts.domain];
  const footer = FOOTER_TEXT[opts.lang](opts.settingsUrl);
  const button = opts.ctaUrl
    ? `<p style="margin:24px 0 0;">
         <a href="${opts.ctaUrl}" style="display:inline-block;background:${color};color:#0b0d10;
            padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
           ${opts.ctaLabel}
         </a>
       </p>`
    : "";

  return `
<!DOCTYPE html>
<html lang="${opts.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:${FONT_STACK};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</span>
  <div style="max-width:600px;margin:0 auto;padding:24px 20px;">
    <div style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:${color};padding:18px 24px;">
        <div style="font-size:13px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;
                    color:#0b0d10;opacity:0.75;">TravStats</div>
        <h1 style="margin:4px 0 0;font-size:20px;line-height:1.3;color:#0b0d10;">${opts.heading}</h1>
      </div>
      <div style="padding:24px;color:#2a2419;font-size:15px;line-height:1.55;">
        ${opts.bodyHtml}
        ${button}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#faf8f3;
                  color:#6b7280;font-size:12px;line-height:1.5;">
        ${footer}
      </div>
    </div>
  </div>
</body>
</html>`.trim();
}
