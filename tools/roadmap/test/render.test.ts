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
          url: "u197",
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
      url: "u",
    },
  ],
  branches: [{ name: "dev/hotels", head: "27389802", ahead: 42, worktree: "/w/hotels" }],
  dependabotPrs: [{ number: 165, title: "Bump tailwindcss", url: "u165" }],
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
});
