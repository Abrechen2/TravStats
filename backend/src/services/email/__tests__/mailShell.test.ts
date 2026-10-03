import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MAIL_PALETTE, renderMailHtml, renderMailText, type MailContent } from "../mailShell";

const CONTENT: MailContent = {
  lang: "de",
  subject: "Subject line",
  preheader: "Preheader text",
  accent: "#4aa6b0",
  eyebrow: "TravStats · Test",
  heading: "Test heading",
  blocks: [
    { kind: "text", text: "A paragraph." },
    {
      kind: "route",
      from: { primary: "FRA", secondary: "Frankfurt am Main", time: "So., 27.09.2026, 09:15 Uhr" },
      to: { primary: "JFK", secondary: null, time: null },
    },
    {
      kind: "facts",
      rows: [
        { label: "Airline", value: "Lufthansa" },
        { label: "Sitzplatz", value: "14C", mono: true },
      ],
    },
    { kind: "code", value: "TempPass123!" },
    { kind: "button", label: "Open", url: "https://example.com/flights/1?a=1&b=2" },
    { kind: "divider" },
    { kind: "link", label: "Link:", url: "https://example.com/plain" },
  ],
  footer: [
    "Switch it off under ",
    { label: "Settings", url: "https://example.com/settings/notifications" },
    ".",
  ],
};

describe("renderMailHtml", () => {
  const html = renderMailHtml(CONTENT);

  it("carries the eyebrow, the heading, every block and the footer", () => {
    for (const text of [
      "TravStats · Test",
      "Test heading",
      "A paragraph.",
      "FRA",
      "Frankfurt am Main",
      "So., 27.09.2026, 09:15 Uhr",
      "JFK",
      "Airline",
      "Lufthansa",
      "Sitzplatz",
      "14C",
      "TempPass123!",
      "Switch it off under ",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="https://example.com/settings/notifications"');
    expect(html).toContain('href="https://example.com/plain"');
  });

  it("is laid out with presentation tables and inline styles, not with divs and a stylesheet", () => {
    expect(html.match(/<table role="presentation"/g)?.length).toBeGreaterThanOrEqual(5);
    // The card, the header band and the canvas carry their colour as an
    // attribute too — Outlook's Word engine reads `bgcolor`, not `background`.
    expect(html).toContain(`bgcolor="${MAIL_PALETTE.paper}"`);
    expect(html).toContain('bgcolor="#4aa6b0"');
  });

  it("loads nothing from anywhere: no image, no stylesheet, no web font, no script", () => {
    expect(html).not.toMatch(/<img|<link|<script|@import|@font-face|url\(|fonts\.googleapis/i);
  });

  it("is light by its inline styles and offers the app's dark surface only through prefers-color-scheme", () => {
    expect(html).toContain(
      `<body class="ts-canvas" style="margin:0;padding:0;background:${MAIL_PALETTE.paper};">`
    );
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    const dark = html.slice(
      html.indexOf("@media (prefers-color-scheme: dark)"),
      html.indexOf("</style>")
    );
    expect(dark).toContain(MAIL_PALETTE.bg);
    expect(dark).toContain(MAIL_PALETTE.surface);
    expect(dark).toContain(MAIL_PALETTE.text);
    // Outside the dark block the dark canvas colour appears only as TEXT on
    // the accent band and button — never as a background.
    const light = html.replace(dark, "");
    expect(light).not.toContain(`background:${MAIL_PALETTE.bg}`);
  });

  it("tints the header band and the button with the accent it is given", () => {
    expect(html).toContain('<td bgcolor="#4aa6b0" style="background:#4aa6b0;padding:20px 28px;');
    expect(html).toMatch(
      /<td bgcolor="#4aa6b0" style="background:#4aa6b0;border-radius:8px;"><a href="https:\/\/example\.com\/flights\/1\?a=1&amp;b=2"[^>]*>Open<\/a>/
    );
  });

  it("falls back to the app accent for anything that is not a plain hex colour", () => {
    const hostile = renderMailHtml({ ...CONTENT, accent: 'red;"><script>alert(1)</script>' });
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain(`bgcolor="${MAIL_PALETTE.accent}"`);
  });

  it("sets <html lang> to the mail's language", () => {
    expect(html).toContain('<html lang="de">');
    expect(renderMailHtml({ ...CONTENT, lang: "en" })).toContain('<html lang="en">');
  });

  it("escapes every string it places — text, labels, values, codes and link targets", () => {
    const x = "<b>x</b>\"'&";
    const hostile = renderMailHtml({
      ...CONTENT,
      subject: x,
      preheader: x,
      eyebrow: x,
      heading: x,
      blocks: [
        { kind: "text", text: x },
        { kind: "text", text: x, muted: true },
        { kind: "subheading", text: x },
        { kind: "route", from: { primary: x, secondary: x, time: x }, to: { primary: x } },
        { kind: "facts", rows: [{ label: x, value: x }] },
        { kind: "code", value: x },
        { kind: "button", label: x, url: `https://example.com/"><b>x</b>` },
        { kind: "link", label: x, url: `https://example.com/"><b>x</b>` },
      ],
      footer: [x, { label: x, url: `https://example.com/"><b>x</b>` }],
    });
    expect(hostile).not.toContain("<b>");
    // Every one of the 18 places the text went, and all four link targets
    // (the plain link shows its URL as text too), arrived escaped.
    expect(hostile.match(/&lt;b&gt;x&lt;\/b&gt;&quot;&#39;&amp;/g)?.length).toBe(18);
    expect(hostile.match(/https:\/\/example\.com\/&quot;&gt;&lt;b&gt;x&lt;\/b&gt;/g)?.length).toBe(
      4
    );
    expect(hostile).not.toContain('https://example.com/"');
  });

  it("draws no table at all for a facts block with no rows", () => {
    const empty = renderMailHtml({ ...CONTENT, blocks: [{ kind: "facts", rows: [] }] });
    // Canvas and card only.
    expect(empty.match(/<table/g)?.length).toBe(2);
  });
});

describe("renderMailText", () => {
  const text = renderMailText(CONTENT);

  it("carries the same facts and links as the HTML part, with no markup", () => {
    expect(text).toBe(
      [
        "TRAVSTATS · TEST",
        "Test heading",
        "A paragraph.",
        "FRA (Frankfurt am Main) — So., 27.09.2026, 09:15 Uhr\n→ JFK",
        "Airline: Lufthansa\nSitzplatz: 14C",
        "    TempPass123!",
        "Open: https://example.com/flights/1?a=1&b=2",
        "----------------------------------------",
        "Link: https://example.com/plain",
        "-- \nSwitch it off under Settings (https://example.com/settings/notifications).",
      ].join("\n\n") + "\n"
    );
  });

  it("passes user text through unescaped — it is never read as markup", () => {
    const hostile = renderMailText({ ...CONTENT, heading: "<b>x</b> & Co" });
    expect(hostile).toContain("<b>x</b> & Co");
    expect(hostile).not.toContain("&lt;");
  });

  it("skips a facts block with no rows instead of leaving a blank paragraph", () => {
    const empty = renderMailText({ ...CONTENT, blocks: [{ kind: "facts", rows: [] }] });
    expect(empty).toBe(
      "TRAVSTATS · TEST\n\nTest heading\n\n-- \nSwitch it off under Settings (https://example.com/settings/notifications).\n"
    );
  });
});

// The palette is the app's, so it must BE the app's: a restated hex survives a
// palette change unseen, and the mail would keep the look of the release before.
describe("mail palette agrees with design/tokens.json", () => {
  const tokens = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../../../design/tokens.json"), "utf-8")
  ) as { color: Record<string, string> };

  it.each(Object.entries(MAIL_PALETTE))("color.%s", (name, hex) => {
    expect(tokens.color[name]).toBe(hex);
  });
});
