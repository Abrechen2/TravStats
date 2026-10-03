import { MAIL_PALETTE, type MailContent } from "./mailShell";

/**
 * The three account mails — password reset, administrator reset, invitation —
 * as `MailContent` for the shared shell (forgejo#189).
 *
 * They are BILINGUAL, German first and English below, unlike the reminders:
 * a reminder knows its recipient's language setting, these do not. An invitee
 * has no account yet, and the reset routes hand over a name and an address
 * only (the forgot-password handler is deliberately kept to the same work for
 * a known and an unknown username, so it is not the place for another
 * lookup). Until then these were German only, which an English-speaking
 * invitee could not read at all.
 *
 * Subjects keep their German wording first so existing mail filters and a
 * recipient who knows the old mails still recognise them.
 */

const FOOTER = ["TravStats"];

const base = {
  lang: "de" as const,
  accent: MAIL_PALETTE.accent,
  footer: FOOTER,
};

export function passwordResetContent(username: string, resetUrl: string): MailContent {
  return {
    ...base,
    subject: "TravStats — Passwort zurücksetzen / Reset your password",
    preheader: "Der Link ist 30 Minuten gültig. / The link is valid for 30 minutes.",
    eyebrow: "TravStats · Konto",
    heading: "Passwort zurücksetzen",
    blocks: [
      { kind: "text", text: `Hallo ${username},` },
      {
        kind: "text",
        text: "du hast eine Passwortzurücksetzung angefordert. Der Link ist 30 Minuten gültig.",
      },
      { kind: "button", label: "Passwort zurücksetzen", url: resetUrl },
      {
        kind: "text",
        text: "Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
        muted: true,
      },
      { kind: "divider" },
      { kind: "subheading", text: "Reset your password" },
      {
        kind: "text",
        text: `Hello ${username}, a password reset was requested for your account. The link is valid for 30 minutes.`,
      },
      { kind: "button", label: "Reset password", url: resetUrl },
      {
        kind: "text",
        text: "If you did not request this, you can ignore this e-mail.",
        muted: true,
      },
      { kind: "link", label: "Link:", url: resetUrl },
    ],
  };
}

export function adminPasswordResetContent(
  username: string,
  temporaryPassword: string
): MailContent {
  return {
    ...base,
    subject: "TravStats — Passwort zurückgesetzt / Password reset",
    preheader:
      "Ein Administrator hat dein Passwort zurückgesetzt. / An administrator has reset your password.",
    eyebrow: "TravStats · Konto",
    heading: "Passwort zurückgesetzt",
    blocks: [
      { kind: "text", text: `Hallo ${username},` },
      {
        kind: "text",
        text: "ein Administrator hat dein Passwort zurückgesetzt. Dein vorläufiges Passwort lautet:",
      },
      { kind: "code", value: temporaryPassword },
      {
        kind: "text",
        text: "Bitte melde dich damit an — du wirst sofort aufgefordert, ein neues Passwort zu wählen.",
      },
      { kind: "divider" },
      { kind: "subheading", text: "Your password was reset" },
      {
        kind: "text",
        text: `Hello ${username}, an administrator has reset your password. The temporary password is shown above. Sign in with it — you will be asked to choose a new password straight away.`,
      },
    ],
  };
}

/**
 * The invitee has no profile zone yet, and the expiry is checked against the
 * instant — so the day is named in UTC, and says so.
 */
function expiryDay(expiresAt: Date, locale: "de-DE" | "en-GB"): string {
  const day = expiresAt.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${day} (UTC)`;
}

export function invitationContent(
  inviterUsername: string,
  inviteUrl: string,
  expiresAt: Date
): MailContent {
  return {
    ...base,
    subject: "TravStats — Einladung / Invitation",
    preheader: `${inviterUsername} hat dich zu TravStats eingeladen. / ${inviterUsername} invited you to TravStats.`,
    eyebrow: "TravStats · Einladung",
    heading: "Du wurdest zu TravStats eingeladen",
    blocks: [
      {
        kind: "text",
        text: `${inviterUsername} hat dich zu TravStats eingeladen — einem privaten Reise-Logbuch für Flüge, Kreuzfahrten, Bahnfahrten und Unterkünfte.`,
      },
      { kind: "button", label: "Konto erstellen", url: inviteUrl },
      {
        kind: "text",
        text: `Die Einladung ist gültig bis ${expiryDay(expiresAt, "de-DE")}. Falls du sie nicht erwartet hast, kannst du diese E-Mail ignorieren.`,
        muted: true,
      },
      { kind: "divider" },
      { kind: "subheading", text: "You have been invited to TravStats" },
      {
        kind: "text",
        text: `${inviterUsername} invited you to TravStats — a private travel logbook for flights, cruises, train rides and stays.`,
      },
      { kind: "button", label: "Create account", url: inviteUrl },
      {
        kind: "text",
        text: `The invitation is valid until ${expiryDay(expiresAt, "en-GB")}. If you were not expecting it, you can ignore this e-mail.`,
        muted: true,
      },
      { kind: "link", label: "Link:", url: inviteUrl },
    ],
  };
}
