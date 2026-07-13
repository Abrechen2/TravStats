import { describe, expect, it } from "vitest";
import { render } from "../src/render.js";
import type { ViewModel } from "../src/model.js";

const VM: ViewModel = {
  generatedAt: "2026-07-13T12:00:00Z",
  decisions: [
    {
      kind: "promote",
      headline: "Promote 2.4.0 — closes 13 issue(s)",
      detail: ["#197 Booking number"],
    },
  ],
  instances: [
    {
      id: "prod",
      label: "Prod",
      role: "production",
      running: "2.3.1",
      expected: "2.3.1",
      mismatch: false,
      error: null,
    },
  ],
  columns: [
    {
      versionId: "2.4.0",
      state: "rc",
      note: null,
      cards: [
        {
          id: "gh-197",
          title: "Booking number missing",
          source: "github",
          sourceRef: 197,
          url: "https://github.com/Abrechen2/TravStats/issues/197",
          status: "fixed-awaiting-release",
          branch: "main",
          notes: "context",
        },
      ],
    },
    { versionId: "unassigned", state: null, note: null, cards: [] },
  ],
  untriaged: [
    {
      channel: "dev-talk",
      author: "alex",
      timestamp: "2026-07-12T14:20:00Z",
      content: "six asks",
      url: "https://discord.com/channels/1/2/3",
    },
  ],
  branches: [{ name: "dev/hotels", head: "27389802", ahead: 42, worktree: "/w/hotels" }],
  dependabotPrs: [
    { number: 165, title: "Bump tailwindcss", url: "https://github.com/Abrechen2/TravStats/pull/165" },
  ],
  warnings: ["Instances: ssh timeout — showing cached state from 2026-07-13T09:00:00Z"],
};

describe("render", () => {
  it("renders all four zones", () => {
    const html = render(VM);
    expect(html).toContain("Jetzt dran");
    expect(html).toContain("Instanzen");
    expect(html).toContain("2.4.0");
    expect(html).toContain("dev/hotels");
  });

  it("renders the untriaged discord messages verbatim", () => {
    expect(render(VM)).toContain("six asks");
  });

  it("shows the staleness warning rather than hiding it", () => {
    expect(render(VM)).toContain("ssh timeout");
  });

  it("is self-contained — no external requests", () => {
    const html = render(VM);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  it("escapes HTML in user-supplied content", () => {
    const evil: ViewModel = {
      ...VM,
      untriaged: [
        {
          channel: "dev-talk",
          author: "alex",
          timestamp: "t",
          content: "<script>alert(1)</script>",
          url: "u",
        },
      ],
    };
    const html = render(evil);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses to render a javascript: URL as a live link on a card", () => {
    const evil: ViewModel = {
      ...VM,
      columns: [
        {
          versionId: "2.4.0",
          state: "rc",
          note: null,
          cards: [
            {
              id: "gh-197",
              title: "Booking number missing",
              source: "github",
              sourceRef: 197,
              url: "javascript:alert(document.cookie)",
              status: "fixed-awaiting-release",
              branch: "main",
              notes: "context",
            },
          ],
        },
        { versionId: "unassigned", state: null, note: null, cards: [] },
      ],
    };
    const html = render(evil);
    expect(html).not.toContain("javascript:alert(document.cookie)");
    // The card must still be visible as text — dropping information silently
    // is exactly the "getting lost" failure mode this tool exists to prevent.
    expect(html).toContain("Booking number missing");
  });

  it("refuses to render a javascript: URL as a live link on the untriaged-message öffnen link", () => {
    const evil: ViewModel = {
      ...VM,
      untriaged: [
        {
          channel: "dev-talk",
          author: "alex",
          timestamp: "2026-07-12T14:20:00Z",
          content: "six asks",
          url: "javascript:alert(document.cookie)",
        },
      ],
    };
    const html = render(evil);
    expect(html).not.toContain("javascript:alert(document.cookie)");
    expect(html).toContain("six asks");
  });

  it("refuses to render a data: URL as a live link on the Dependabot PR link", () => {
    const evil: ViewModel = {
      ...VM,
      dependabotPrs: [{ number: 165, title: "Bump tailwindcss", url: "data:text/html,<script>1</script>" }],
    };
    const html = render(evil);
    expect(html).not.toContain("data:text/html");
    expect(html).toContain("Bump tailwindcss");
  });

  it("still renders a normal https URL as a live link", () => {
    const html = render(VM);
    expect(html).toContain('href="https://github.com/Abrechen2/TravStats/issues/197"');
    expect(html).toContain('href="https://github.com/Abrechen2/TravStats/pull/165"');
  });

  it("renders the branch head commit SHA", () => {
    const html = render(VM);
    expect(html).toContain("27389802");
  });
});
