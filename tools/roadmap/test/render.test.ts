import { describe, expect, it } from "vitest";
import { render } from "../src/render.js";
import type { ViewModel } from "../src/model.js";

const VM: ViewModel = {
  generatedAt: "2026-07-13T12:00:00Z",
  decisions: [
    {
      kind: "promote",
      headline: "2.4.0 freigeben — schließt 13 Issue(s)",
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
      branch: "main",
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
          closed: false,
        },
      ],
    },
    { versionId: "unassigned", state: null, branch: null, note: null, cards: [] },
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
    {
      number: 165,
      title: "Bump tailwindcss",
      url: "https://github.com/Abrechen2/TravStats/pull/165",
    },
  ],
  warnings: ["Instances: ssh timeout — showing cached state from 2026-07-13T09:00:00Z"],
};

describe("render", () => {
  it("renders all the main zones", () => {
    const html = render(VM);
    expect(html).toContain("Entscheidungen");
    expect(html).toContain("Wo läuft was");
    expect(html).toContain("Releases");
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
          branch: "main",
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
              closed: false,
            },
          ],
        },
        { versionId: "unassigned", state: null, branch: null, note: null, cards: [] },
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
      dependabotPrs: [
        { number: 165, title: "Bump tailwindcss", url: "data:text/html,<script>1</script>" },
      ],
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

  it("collapses a promote decision's evidence behind a details toggle instead of listing it inline", () => {
    const withManyIssues: ViewModel = {
      ...VM,
      decisions: [
        {
          kind: "promote",
          headline: "2.4.0 freigeben — schließt 13 Issue(s)",
          detail: Array.from({ length: 13 }, (_, i) => `#${100 + i} Issue ${i}`),
        },
      ],
    };
    const html = render(withManyIssues);
    expect(html).toContain('<details class="d-more">');
    expect(html).toContain("13 Einträge anzeigen");
    expect(html).toContain("#100 Issue 0");
  });

  it("shows a two-line decision inline, without a details toggle", () => {
    const html = render(VM);
    // Only one detail line here — must not be wrapped in the "show more" toggle.
    expect(html).not.toContain('<details class="d-more">');
  });

  it("marks the current RC and Unassigned rows as open by default, and released as closed", () => {
    const withReleased: ViewModel = {
      ...VM,
      columns: [
        { versionId: "2.3.0", state: "released", branch: null, note: null, cards: [] },
        { versionId: "2.4.0", state: "rc", branch: "main", note: null, cards: [] },
        { versionId: "unassigned", state: null, branch: null, note: null, cards: [] },
      ],
    };
    const html = render(withReleased);
    const rows = html.split('<details class="release-row"').slice(1);
    const released = rows.find((r) => r.includes(">2.3.0<"));
    const rc = rows.find((r) => r.includes(">2.4.0<"));
    const unassigned = rows.find((r) => r.includes(">Nicht zugeordnet<"));
    expect(released?.startsWith(">")).toBe(true);
    expect(rc?.startsWith(" open>")).toBe(true);
    expect(unassigned?.startsWith(" open>")).toBe(true);
  });

  it("shows a closed card with a visible closed badge", () => {
    const withClosed: ViewModel = {
      ...VM,
      columns: [
        {
          versionId: "2.4.0",
          state: "rc",
          branch: "main",
          note: null,
          cards: [
            {
              id: "gh-178",
              title: "Promote 2.4.0",
              source: "github",
              sourceRef: 178,
              url: "https://github.com/Abrechen2/TravStats/issues/178",
              status: "done",
              branch: null,
              notes: null,
              closed: true,
            },
          ],
        },
      ],
    };
    const html = render(withClosed);
    expect(html).toContain("geschlossen");
  });

  it("groups untriaged messages by channel and day instead of listing them flat", () => {
    const many: ViewModel = {
      ...VM,
      untriaged: [
        {
          channel: "dev-talk",
          author: "alex",
          timestamp: "2026-07-12T09:00:00.000Z",
          content: "a",
          url: "u1",
        },
        {
          channel: "dev-talk",
          author: "alex",
          timestamp: "2026-07-12T10:00:00.000Z",
          content: "b",
          url: "u2",
        },
        {
          channel: "beta",
          author: "sam",
          timestamp: "2026-07-13T08:00:00.000Z",
          content: "c",
          url: "u3",
        },
      ],
    };
    const html = render(many);
    expect(html).toContain("#dev-talk · 2 Nachricht(en) · 2026-07-12");
    expect(html).toContain("#beta · 1 Nachricht(en) · 2026-07-13");
  });

  it("moves the version note and Dependabot table into the collapsed diagnostics section", () => {
    const withNote: ViewModel = {
      ...VM,
      columns: [
        {
          versionId: "2.4.0",
          state: "rc",
          branch: "main",
          note: "Blocked on infra migration",
          cards: [],
        },
      ],
    };
    const html = render(withNote);
    expect(html).toContain('<details class="diagnostics">');
    expect(html).toContain("Blocked on infra migration");
    expect(html).toContain("Bump tailwindcss");
    // Only one rendering of the Dependabot PR list on the whole page.
    expect(html.match(/Bump tailwindcss/g)).toHaveLength(1);
  });
});
