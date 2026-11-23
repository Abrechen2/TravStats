import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ReadinessInvitationCard, { invitationBlocked } from "../ReadinessInvitationCard";
import ReadinessBanner from "../ReadinessBanner";
import { fetchReadiness, snoozeInvitation } from "../../../lib/api/readiness";
import { useReadinessShellStore } from "../../../store/readinessShellStore";

const demoFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demoFlag.on }));
vi.mock("../../../lib/api/readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/readiness")>();
  return {
    ...actual,
    fetchReadiness: vi.fn(),
    fetchReadinessAttention: vi.fn().mockResolvedValue({ problem: 0, warning: 0 }),
    snoozeInvitation: vi.fn(),
  };
});

const invitation = (over = {}) => ({
  show: true,
  reason: "update" as "update" | "required" | null,
  snoozedUntil: null,
  keys: [],
  ...over,
});

const mount = (blocked = false, path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ReadinessInvitationCard blocked={blocked} />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  demoFlag.on = false;
  useReadinessShellStore.getState().reset();
  vi.mocked(fetchReadiness).mockResolvedValue({
    invitation: invitation({ show: false, reason: null }),
    banner: { show: false, itemIds: [] },
    summary: { required: 0, recommended: 0, unknown: 0, newNotes: 0, blockedByAdmin: 0, ready: 0 },
  } as never);
});
afterEach(cleanup);

describe("invitation card actions", () => {
  it("renders 'Jetzt ansehen' with the primary-button skin, not the dark-on-dark text link", () => {
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    const link = screen.getByRole("link", { name: "readiness:invitation.view" });
    expect(link).toHaveAttribute("data-variant", "primary");
    expect(link).toHaveClass("ts-button");
    expect(link.style.background).toBe("var(--ts-accent)");
    expect(link).not.toHaveClass("underline");
    const secondary = screen.getByRole("button", { name: "readiness:snooze" });
    expect(secondary).toHaveAttribute("data-variant", "secondary");
    expect(secondary.style.height).toBe(link.style.height);
  });
});

describe("invitation card visibility", () => {
  it("shows with the update copy", () => {
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    expect(screen.getByTestId("readiness-invitation")).toBeInTheDocument();
    expect(screen.getByText("readiness:invitation.reason.update")).toBeInTheDocument();
  });

  it("shows the required copy when the reason is required", () => {
    useReadinessShellStore.setState({ invitation: invitation({ reason: "required" }) });
    mount();
    expect(screen.getByText("readiness:invitation.reason.required")).toBeInTheDocument();
  });

  it("stays hidden when the server says show=false (snoozed or nothing new)", () => {
    useReadinessShellStore.setState({
      invitation: invitation({ show: false, snoozedUntil: "2026-11-16T10:00:00Z" }),
    });
    mount();
    expect(screen.queryByTestId("readiness-invitation")).toBeNull();
  });

  it("stays hidden before the first read", () => {
    mount();
    expect(screen.queryByTestId("readiness-invitation")).toBeNull();
  });

  it("is never shown to the shared demo account, whose writes are refused", () => {
    demoFlag.on = true;
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    expect(screen.queryByTestId("readiness-invitation")).toBeNull();
  });

  it("does not sit on top of the page it invites to", () => {
    useReadinessShellStore.setState({ invitation: invitation() });
    mount(false, "/settings/einrichtung");
    expect(screen.queryByTestId("readiness-invitation")).toBeNull();
  });
});

describe("invitation card sequencing", () => {
  const settled = {
    whatsNewChecked: true,
    whatsNewOpen: false,
    consentSettled: true,
    consentOpen: false,
  };

  it("waits while the what's-new check is still in flight", () => {
    expect(invitationBlocked({ ...settled, whatsNewChecked: false })).toBe(true);
  });
  it("waits while the what's-new modal is open", () => {
    expect(invitationBlocked({ ...settled, whatsNewOpen: true })).toBe(true);
  });
  it("waits while the consent question is still loading (it may yet appear)", () => {
    expect(invitationBlocked({ ...settled, consentSettled: false })).toBe(true);
  });
  it("waits while the consent step is open", () => {
    expect(invitationBlocked({ ...settled, consentOpen: true })).toBe(true);
  });
  it("is free once both have settled and neither is open", () => {
    expect(invitationBlocked(settled)).toBe(false);
  });

  it("renders nothing while blocked and appears when the block lifts", () => {
    useReadinessShellStore.setState({ invitation: invitation() });
    const view = render(
      <MemoryRouter>
        <ReadinessInvitationCard blocked />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("readiness-invitation")).toBeNull();
    view.rerender(
      <MemoryRouter>
        <ReadinessInvitationCard blocked={false} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("readiness-invitation")).toBeInTheDocument();
  });
});

describe("invitation card actions", () => {
  it("links to the readiness page", () => {
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    expect(screen.getByRole("link", { name: "readiness:invitation.view" })).toHaveAttribute(
      "href",
      "/settings/einrichtung"
    );
  });

  it("snoozes, hides the card and re-reads once", async () => {
    vi.mocked(snoozeInvitation).mockResolvedValue(undefined);
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "readiness:snooze" }));
    await waitFor(() => expect(screen.queryByTestId("readiness-invitation")).toBeNull());
    expect(snoozeInvitation).toHaveBeenCalledTimes(1);
    expect(fetchReadiness).toHaveBeenCalledTimes(1);
  });

  it("shows the card again when a later read says show=true (the snooze is not remembered locally)", async () => {
    vi.mocked(snoozeInvitation).mockResolvedValue(undefined);
    vi.mocked(fetchReadiness).mockResolvedValue({
      invitation: invitation(),
      banner: { show: false, itemIds: [] },
      summary: {
        required: 0,
        recommended: 0,
        unknown: 0,
        newNotes: 0,
        blockedByAdmin: 0,
        ready: 0,
      },
    } as never);
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "readiness:snooze" }));
    expect(await screen.findByTestId("readiness-invitation")).toBeInTheDocument();
  });

  it("keeps the card and says so when the snooze fails with a 500", async () => {
    vi.mocked(snoozeInvitation).mockRejectedValue(new Error("500"));
    useReadinessShellStore.setState({ invitation: invitation() });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "readiness:snooze" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("readiness:invitation.snoozeFailed");
    expect(screen.getByTestId("readiness-invitation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "readiness:snooze" })).toBeEnabled();
  });
});

describe("admin banner", () => {
  const mountBanner = () =>
    render(
      <MemoryRouter>
        <ReadinessBanner />
      </MemoryRouter>
    );

  it("shows only when banner.show, with a link and no close button", () => {
    useReadinessShellStore.setState({
      banner: { show: true, itemIds: ["adminSmtp", "adminBackup"] },
    });
    mountBanner();
    expect(screen.getByTestId("readiness-banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "readiness:banner.link" })).toHaveAttribute(
      "href",
      "/settings/einrichtung"
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is absent when banner.show is false, even with item ids", () => {
    useReadinessShellStore.setState({ banner: { show: false, itemIds: ["adminSmtp"] } });
    mountBanner();
    expect(screen.queryByTestId("readiness-banner")).toBeNull();
  });

  it("is absent before the first read", () => {
    mountBanner();
    expect(screen.queryByTestId("readiness-banner")).toBeNull();
  });
});
