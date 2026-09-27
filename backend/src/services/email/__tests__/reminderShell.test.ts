import { describe, it, expect } from "@jest/globals";
import { renderReminderShell, REMINDER_DOMAIN_COLORS } from "../reminderShell";

const BASE_OPTS = {
  preheader: "Preheader text",
  heading: "Test heading",
  bodyHtml: "<p>body</p>",
  ctaUrl: "https://example.com/flights/1",
  ctaLabel: "Open",
  settingsUrl: "https://example.com/settings/notifications",
};

describe("renderReminderShell", () => {
  it("tints the header bar with the domain's own colour, per domain", () => {
    for (const [domain, color] of Object.entries(REMINDER_DOMAIN_COLORS)) {
      const html = renderReminderShell({
        ...BASE_OPTS,
        lang: "de",
        domain: domain as keyof typeof REMINDER_DOMAIN_COLORS,
      });
      expect(html).toContain(color);
    }
  });

  it("carries the TravStats wordmark, the heading and the body", () => {
    const html = renderReminderShell({ ...BASE_OPTS, lang: "de", domain: "flight" });
    expect(html).toContain("TravStats");
    expect(html).toContain("Test heading");
    expect(html).toContain("<p>body</p>");
  });

  it("links the CTA button to the given URL with the given label", () => {
    const html = renderReminderShell({ ...BASE_OPTS, lang: "en", domain: "cruise" });
    expect(html).toContain('href="https://example.com/flights/1"');
    expect(html).toMatch(/<a href="https:\/\/example\.com\/flights\/1"[^]*?>\s*Open\s*<\/a>/);
  });

  it("omits the CTA button entirely when ctaUrl is null", () => {
    const html = renderReminderShell({ ...BASE_OPTS, lang: "de", domain: "rail", ctaUrl: null });
    expect(html).not.toContain("Open");
  });

  it("links the settings page and names the DE/EN settings path in the footer", () => {
    const de = renderReminderShell({ ...BASE_OPTS, lang: "de", domain: "flight" });
    expect(de).toContain("Einstellungen → Benachrichtigungen");
    expect(de).toContain('href="https://example.com/settings/notifications"');

    const en = renderReminderShell({ ...BASE_OPTS, lang: "en", domain: "flight" });
    expect(en).toContain("Settings → Notifications");
  });

  it("uses a light background and a system font stack, never a web font or dark scheme", () => {
    const html = renderReminderShell({ ...BASE_OPTS, lang: "de", domain: "flight" });
    expect(html).toContain("#f5f1e8"); // light canvas
    expect(html).not.toMatch(/@import|fonts\.googleapis|prefers-color-scheme/);
  });

  it("sets the declared <html lang> to the reminder's language", () => {
    expect(renderReminderShell({ ...BASE_OPTS, lang: "de", domain: "flight" })).toContain(
      '<html lang="de">'
    );
    expect(renderReminderShell({ ...BASE_OPTS, lang: "en", domain: "flight" })).toContain(
      '<html lang="en">'
    );
  });

  it("is well-formed enough to parse as a single HTML document", () => {
    const html = renderReminderShell({ ...BASE_OPTS, lang: "de", domain: "lodging" });
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<body");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });
});
