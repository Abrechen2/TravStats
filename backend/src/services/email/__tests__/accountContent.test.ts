import { describe, it, expect } from "@jest/globals";
import { renderMailHtml, renderMailText } from "../mailShell";
import {
  adminPasswordResetContent,
  invitationContent,
  passwordResetContent,
} from "../accountContent";

const RESET_URL = "https://travstats.test/reset-password?token=abc&x=1";

describe("passwordResetContent", () => {
  const content = passwordResetContent("alice", RESET_URL);
  const html = renderMailHtml(content);
  const text = renderMailText(content);

  it("keeps the German subject recognisable and adds the English one", () => {
    expect(content.subject).toBe("TravStats — Passwort zurücksetzen / Reset your password");
  });

  it("speaks German first and English below, and says how long the link lasts in both", () => {
    for (const part of [html, text]) {
      expect(part).toContain("Hallo alice,");
      expect(part).toContain("30 Minuten gültig");
      expect(part).toContain("Hello alice,");
      expect(part).toContain("valid for 30 minutes");
      expect(part.indexOf("Hallo alice")).toBeLessThan(part.indexOf("Hello alice"));
    }
  });

  it("carries the reset link as a button target and as readable text", () => {
    expect(html).toContain('href="https://travstats.test/reset-password?token=abc&amp;x=1"');
    expect(text).toContain(`Passwort zurücksetzen: ${RESET_URL}`);
    expect(text).toContain(`Link: ${RESET_URL}`);
  });

  // Before the shared shell the username went into the markup raw.
  it("escapes the username", () => {
    const hostile = renderMailHtml(passwordResetContent("<script>alert(1)</script>", RESET_URL));
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("adminPasswordResetContent", () => {
  it("shows the temporary password once, verbatim in text and escaped in HTML", () => {
    const content = adminPasswordResetContent("bob", "p<ss&w0rd");
    const html = renderMailHtml(content);
    const text = renderMailText(content);
    expect(content.subject).toBe("TravStats — Passwort zurückgesetzt / Password reset");
    expect(html).toContain("p&lt;ss&amp;w0rd");
    expect(html).not.toContain("p<ss");
    expect(text.split("p<ss&w0rd").length - 1).toBe(1);
    expect(text).toContain("Hallo bob,");
    expect(text).toContain("Hello bob,");
  });
});

describe("invitationContent", () => {
  // 23:30 UTC on the 14th. Read on a host east of UTC this instant is already
  // the 15th, so a formatter that used the host's zone would name the wrong
  // day; the CI re-runs this under TZ=Pacific/Kiritimati and America/St_Johns.
  const expiresAt = new Date("2026-10-14T23:30:00.000Z");
  const content = invitationContent("admin", "https://travstats.test/invite?t=xyz", expiresAt);
  const html = renderMailHtml(content);
  const text = renderMailText(content);

  it("names the inviter, the link and what TravStats is, in both languages", () => {
    expect(content.subject).toBe("TravStats — Einladung / Invitation");
    for (const part of [html, text]) {
      expect(part).toContain("admin hat dich zu TravStats eingeladen");
      expect(part).toContain("admin invited you to TravStats");
      expect(part).toContain("https://travstats.test/invite?t=xyz");
    }
    // The app stopped being flights-only long before this mail said so.
    expect(text).not.toContain("Flugreisen");
  });

  it("names the expiry day in UTC, and says so, whatever the host's zone", () => {
    expect(text).toContain("gültig bis 14. Oktober 2026 (UTC)");
    expect(text).toContain("valid until 14 October 2026 (UTC)");
  });

  it("escapes the inviter's name", () => {
    const hostile = renderMailHtml(
      invitationContent("<b>x</b>", "https://travstats.test/invite?t=xyz", expiresAt)
    );
    expect(hostile).not.toContain("<b>");
  });
});
