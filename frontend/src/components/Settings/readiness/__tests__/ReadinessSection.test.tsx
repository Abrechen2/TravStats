import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ReadinessSection from "../ReadinessSection";
import {
  fetchReadiness,
  fetchReadinessEntries,
  markInvitationSeen,
  optOutReadinessItem,
  snoozeReadinessItem,
  type ReadinessItem,
  type ReadinessNote,
  type ReadinessResponse,
} from "../../../../lib/api/readiness";
import { groupReadiness } from "../readinessModel";
import { useAuthStore } from "../../../../store/authStore";

const demoFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demoFlag.on }));
vi.mock("../../../../lib/api/readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/readiness")>();
  return {
    ...actual,
    fetchReadiness: vi.fn(),
    fetchReadinessAttention: vi.fn().mockResolvedValue({ problem: 0, warning: 0 }),
    fetchReadinessEntries: vi.fn(),
    markInvitationSeen: vi.fn().mockResolvedValue(undefined),
    snoozeReadinessItem: vi.fn().mockResolvedValue(undefined),
    optOutReadinessItem: vi.fn().mockResolvedValue(undefined),
    clearReadinessItemState: vi.fn().mockResolvedValue(undefined),
    acknowledgeReadinessNote: vi.fn().mockResolvedValue(undefined),
  };
});

const item = (over: Partial<ReadinessItem> & { id: string }): ReadinessItem => ({
  revision: 1,
  scope: "user",
  severity: "recommended",
  status: "needsAction",
  checkedAt: null,
  count: null,
  titleKey: `check.${over.id}.title`,
  consequenceKey: `check.${over.id}.consequence`,
  actionKey: null,
  entryList: false,
  action: "/settings/reisearten",
  blockedBy: null,
  optOutAllowed: true,
  userState: null,
  ...over,
});

const note = (over: Partial<ReadinessNote> & { id: string }): ReadinessNote => ({
  version: "2.8.0",
  audience: "user",
  beforeKey: `note.${over.id}.before`,
  afterKey: `note.${over.id}.after`,
  action: null,
  noActionReason: "informational",
  acknowledged: false,
  open: true,
  ...over,
});

const response = (items: ReadinessItem[], notes: ReadinessNote[] = []): ReadinessResponse => ({
  runningVersion: "2.8.0-rc.30",
  summary: { required: 0, recommended: 0, unknown: 0, newNotes: 0, blockedByAdmin: 0, ready: 0 },
  items,
  notes,
  invitation: { show: false, reason: null, snoozedUntil: null, keys: [] },
  banner: { show: false, itemIds: [] },
});

function setUser(isAdmin: boolean): void {
  useAuthStore.setState({
    user: { id: "u", username: "u", isAdmin },
  } as unknown as Parameters<typeof useAuthStore.setState>[0]);
}

const show = (data: ReadinessResponse): void => {
  vi.mocked(fetchReadiness).mockResolvedValue(data);
  render(
    <MemoryRouter>
      <ReadinessSection />
    </MemoryRouter>
  );
};

const groupOf = (id: string): string | null =>
  document.querySelector(`[data-item="${id}"]`)?.getAttribute("data-group") ?? null;

describe("readiness page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demoFlag.on = false;
    setUser(true);
  });

  it("tells the server the invitation was seen exactly once per open, even across re-renders", async () => {
    vi.mocked(fetchReadiness).mockResolvedValue(response([item({ id: "a" })]));
    const view = render(
      <MemoryRouter>
        <ReadinessSection />
      </MemoryRouter>
    );
    await screen.findByText("readiness:check.a.title");
    view.rerender(
      <MemoryRouter>
        <ReadinessSection />
      </MemoryRouter>
    );
    await waitFor(() => expect(markInvitationSeen).toHaveBeenCalledTimes(1));
  });

  it("posts the keys of the response it rendered to invitation/seen", async () => {
    const res = response([item({ id: "a" })]);
    res.invitation = { show: true, reason: "required", snoozedUntil: null, keys: ["a", "n.1"] };
    show(res);
    await waitFor(() => expect(markInvitationSeen).toHaveBeenCalledWith(["a", "n.1"]));
  });

  it("does not write invitation/seen for the demo account", async () => {
    demoFlag.on = true;
    show(response([item({ id: "a" })]));
    await screen.findByText("readiness:check.a.title");
    expect(markInvitationSeen).not.toHaveBeenCalled();
  });

  it("does not mark the invitation seen when the page itself failed to load", async () => {
    vi.mocked(fetchReadiness).mockRejectedValue(new Error("500"));
    render(
      <MemoryRouter>
        <ReadinessSection />
      </MemoryRouter>
    );
    await screen.findByText("readiness:error.title");
    expect(markInvitationSeen).not.toHaveBeenCalled();
  });

  it("still renders the page when invitation/seen fails", async () => {
    vi.mocked(markInvitationSeen).mockRejectedValueOnce(new Error("500"));
    show(response([item({ id: "a" })]));
    expect(await screen.findByText("readiness:check.a.title")).toBeInTheDocument();
  });

  it("orders the groups muss, empfohlen, neu, Braucht den Admin, bereit (owner, 2026-11-23)", async () => {
    show(
      response(
        [
          item({ id: "ready1", status: "ready" }),
          item({ id: "blocked1", blockedBy: "smtp", action: null }),
          item({ id: "rec1" }),
          item({ id: "req1", scope: "admin", severity: "required", optOutAllowed: false }),
        ],
        [note({ id: "n1" })]
      )
    );
    await screen.findByText("readiness:check.req1.title");
    const order = Array.from(document.querySelectorAll("section[id^=readiness-group-]")).map(
      (s) => s.id
    );
    expect(order).toEqual([
      "readiness-group-required",
      "readiness-group-recommended",
      "readiness-group-new",
      "readiness-group-blocked",
      "readiness-group-ready",
    ]);
    expect(groupOf("req1")).toBe("required");
    expect(groupOf("blocked1")).toBe("blocked");
    expect(groupOf("ready1")).toBe("ready");
    expect(document.querySelector("#readiness-group-ready details")?.hasAttribute("open")).toBe(
      false
    );
  });

  it("never shows an unchecked required item as muss, and marks it ungeprüft", async () => {
    show(
      response([
        item({
          id: "smtp",
          scope: "admin",
          severity: "required",
          status: "unknown",
          optOutAllowed: false,
        }),
      ])
    );
    await screen.findByText("readiness:check.smtp.title");
    expect(groupOf("smtp")).toBe("recommended");
    expect(document.querySelector("#readiness-group-required")).toBeNull();
    const row = document.querySelector('[data-item="smtp"]') as HTMLElement;
    expect(within(row).getByText("readiness:unchecked")).toBeTruthy();
    expect(within(row).getByText("readiness:neverChecked")).toBeTruthy();
    // its own action is the way to check it
    expect(within(row).getByText("readiness:checkNow")).toBeTruthy();
  });

  // Owner, 2026-11-20: "Öffnen" was near-black on the dark card. The link wore
  // --ts-accent-text, the ink meant for text ON an accent fill.
  it("draws a plain link in the accent colour, and a filled one only with the ink for an accent fill", async () => {
    show(
      response([
        item({ id: "unchecked1", status: "unknown" }),
        item({ id: "optional1", actionKey: "check.optional1.action" }),
      ])
    );
    await screen.findByText("readiness:check.optional1.title");
    const plain = screen.getByText("readiness:checkNow");
    expect(plain.style.color).toBe("var(--ts-accent)");
    const filled = screen.getByText("readiness:check.optional1.action");
    expect(filled.style.background).toBe("var(--ts-accent)");
    expect(filled.style.color).toBe("var(--ts-accent-text)");
  });

  it("draws an item that needs action large, with its severity's edge and its own fix (owner, 2026-11-23)", async () => {
    show(
      response([
        item({ id: "req1", scope: "admin", severity: "required", optOutAllowed: false }),
        item({ id: "rec1", count: 3, actionKey: "check.rec1.action" }),
        item({ id: "unchecked1", status: "unknown" }),
      ])
    );
    await screen.findByText("readiness:check.rec1.title");
    const row = (id: string) => document.querySelector(`[data-item="${id}"]`) as HTMLElement;
    expect(row("req1").dataset.prominent).toBe("problem");
    expect(row("req1").style.borderLeft).toContain("var(--ts-bad)");
    expect(row("rec1").dataset.prominent).toBe("warning");
    expect(row("rec1").style.borderLeft).toContain("var(--ts-warn)");
    expect(row("unchecked1").dataset.prominent).toBeUndefined();
    // Verified "needs action" first inside the recommendations.
    const recs = Array.from(
      document.querySelectorAll("#readiness-group-recommended [data-item]")
    ).map((el) => el.getAttribute("data-item"));
    expect(recs).toEqual(["rec1", "unchecked1"]);
    expect(within(row("rec1")).getByText("readiness:check.rec1.action").tagName).toBe("A");
  });

  it("lists a data check's entries on demand, each linking to its page, and says so when the list fails", async () => {
    vi.mocked(fetchReadinessEntries).mockResolvedValueOnce({
      total: 2,
      entries: [
        { id: "f1", kind: "flight", label: "LH400 FRA–JFK", date: null, href: "/flights/f1" },
        { id: "f2", kind: "flight", label: "LH401 JFK–FRA", date: null, href: "/flights/f2" },
      ],
    });
    show(
      response([
        item({
          id: "user.flightsNoTimes",
          count: 2,
          entryList: true,
          actionKey: "check.noTimes.action",
          action: "/settings/einrichtung",
        }),
      ])
    );
    fireEvent.click(await screen.findByText("readiness:check.noTimes.action"));
    const link = await screen.findByText("LH400 FRA–JFK");
    expect(link.closest("a")?.getAttribute("href")).toBe("/flights/f1");
    expect(fetchReadinessEntries).toHaveBeenCalledWith("user.flightsNoTimes");

    fireEvent.click(screen.getByText("readiness:entries.hide"));
    vi.mocked(fetchReadinessEntries).mockRejectedValueOnce(new Error("down"));
    fireEvent.click(screen.getByText("readiness:check.noTimes.action"));
    expect(await screen.findByRole("alert")).toHaveTextContent("readiness:entries.error");
  });

  it("offers 'nutze ich nicht' only where the item allows it, never for a required one", async () => {
    show(
      response([
        item({ id: "optional1" }),
        item({ id: "req1", severity: "required", optOutAllowed: false }),
        // a server that wrongly allows opt-out on a required item must not make the button appear
        item({ id: "req2", severity: "required", optOutAllowed: true }),
      ])
    );
    await screen.findByText("readiness:check.optional1.title");
    const optOut = (id: string): HTMLElement | null =>
      within(document.querySelector(`[data-item="${id}"]`) as HTMLElement).queryByText(
        "readiness:optOut"
      );
    expect(optOut("optional1")).toBeTruthy();
    expect(optOut("req1")).toBeNull();
    expect(optOut("req2")).toBeNull();
  });

  it("snoozes and opts out through the API", async () => {
    show(response([item({ id: "a" })]));
    await screen.findByText("readiness:check.a.title");
    fireEvent.click(screen.getByText("readiness:snooze"));
    await waitFor(() => expect(snoozeReadinessItem).toHaveBeenCalledWith("a", expect.any(String)));
    fireEvent.click(screen.getByText("readiness:optOut"));
    await waitFor(() => expect(optOutReadinessItem).toHaveBeenCalledWith("a"));
  });

  it("shows its own error state when the GET fails, not an all-clear", async () => {
    vi.mocked(fetchReadiness).mockRejectedValue(new Error("boom"));
    render(
      <MemoryRouter>
        <ReadinessSection />
      </MemoryRouter>
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("readiness:error.title");
    expect(screen.queryByText("readiness:empty")).toBeNull();
    expect(screen.getByText("readiness:error.retry")).toBeTruthy();
  });

  it("gives an ordinary account no address for an item blocked by an admin item", async () => {
    setUser(false);
    show(
      response([
        // a server slip: the address of the admin's configuration rides along
        item({ id: "invite", blockedBy: "smtp", action: "/settings/email#smtp" }),
      ])
    );
    await screen.findByText("readiness:check.invite.title");
    const row = document.querySelector('[data-item="invite"]') as HTMLElement;
    expect(row.querySelector("a")).toBeNull();
    expect(row.textContent).not.toContain("smtp");
    expect(within(row).getByText("readiness:blockedHint")).toBeTruthy();
  });

  it("keeps a snoozed item out of its group until the snooze ends", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    const data = response([
      item({ id: "s1", userState: { kind: "snoozed", until: "2026-11-15T10:00:00Z" } }),
      item({ id: "s2", userState: { kind: "snoozed", until: "2026-11-13T10:00:00Z" } }),
      item({ id: "o1", userState: { kind: "optedOut" } }),
    ]);
    const g = groupReadiness(data, false, now);
    expect(g.parked.map((i) => i.id)).toEqual(["s1", "o1"]);
    expect(g.recommended.map((i) => i.id)).toEqual(["s2"]);
  });

  it("a check-backed note carries no acknowledge button; an informational one does", async () => {
    show(
      response(
        [
          item({
            id: "backup",
            scope: "admin",
            severity: "required",
            optOutAllowed: false,
            action: "/settings/sicherungen",
          }),
        ],
        [
          note({
            id: "backupsAlwaysOn",
            action: { kind: "check", checkId: "backup" },
            noActionReason: null,
          }),
          note({ id: "friendsMerged" }),
        ]
      )
    );
    await screen.findByText("readiness:note.friendsMerged.before");
    const checkBacked = document.querySelector('[data-note="backupsAlwaysOn"]') as HTMLElement;
    const info = document.querySelector('[data-note="friendsMerged"]') as HTMLElement;
    expect(within(checkBacked).queryByText("readiness:note.ack")).toBeNull();
    expect(within(info).getByText("readiness:note.ack")).toBeTruthy();
  });
});
