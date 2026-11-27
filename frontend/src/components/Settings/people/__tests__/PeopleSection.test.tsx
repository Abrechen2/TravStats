import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import PeopleSection from "../PeopleSection";
import { companionsApi, type ManagedCompanion } from "../../../../lib/api/companions";
import { comparisonApi } from "../../../../lib/api/comparison";
import { sharingApi } from "../../../../lib/api/sharing";
import { sharingConnectionsApi } from "../../../../lib/api/sharingConnections";
import { sharingRemoteApi } from "../../../../lib/api/sharingRemote";
import { logger } from "../../../../lib/logger";

/**
 * Settings → Freunde & Teilen → Personen: ONE list (a companion linked to an account is one row),
 * per-person switches that call the same consent APIs as before, gated switches that are absent
 * while their beta key is off, requests above the list, and failures that are said and logged.
 */
const beta = new Set<string>();
vi.mock("../../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: (key: string) => beta.has(key) }),
}));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));
vi.mock("../../../../lib/api/companions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/companions")>()),
  companionsApi: { manage: vi.fn() },
}));
vi.mock("../../../../lib/api/sharing", () => ({
  sharingApi: {
    listConsents: vi.fn(),
    listCompanions: vi.fn(),
    requestConsent: vi.fn(),
    answerConsent: vi.fn(),
  },
}));
vi.mock("../../../../lib/api/sharingConnections", () => ({
  sharingConnectionsApi: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
}));
vi.mock("../../../../lib/api/sharingRemote", () => ({
  sharingRemoteApi: { status: vi.fn(), listPeople: vi.fn(), listServers: vi.fn() },
}));
vi.mock("../../../../lib/api/comparison", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/comparison")>()),
  comparisonApi: {
    people: vi.fn(),
    request: vi.fn(),
    end: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
  },
}));
vi.mock("../../../sharing/ReceivedRemoteOffers", () => ({ default: () => null }));
vi.mock("../../../sharing/RemotePlanInvitations", () => ({ default: () => null }));
vi.mock("../../../comparison/ConsentDialog", () => ({
  default: ({ onConfirm }: { onConfirm: (s: unknown) => Promise<void> }) => (
    <button onClick={() => void onConfirm({ groups: [], domains: [], year: null })}>
      consent-dialog-confirm
    </button>
  ),
}));

const companion = (over: Partial<ManagedCompanion>): ManagedCompanion => ({
  id: "c1",
  name: "Jonas",
  linkedUser: null,
  uses: { flight: 2 },
  hiddenUses: 0,
  expensesPaid: 0,
  lastTogether: null,
  inUse: true,
  ...over,
});
const jonasAccount = { id: "u1", username: "jonas", displayName: "Jonas K." };
const consent = (over: object) => ({
  id: "k1",
  status: "accepted",
  createdAt: "2026-11-01T00:00:00Z",
  decidedAt: null,
  person: jonasAccount,
  ...over,
});

const comp = vi.mocked(companionsApi);
const share = vi.mocked(sharingApi);
const cmp = vi.mocked(comparisonApi);
const conns = vi.mocked(sharingConnectionsApi);
const remote = vi.mocked(sharingRemoteApi);

function setup(opts: {
  companions?: ManagedCompanion[];
  outgoing?: object[];
  incoming?: object[];
  people?: object[];
  requests?: object[];
  connections?: object[];
  consentsFail?: boolean;
}) {
  comp.manage.mockResolvedValue({
    companions: opts.companions ?? [],
    kinds: ["flight"],
  } as never);
  share.listConsents.mockResolvedValue({
    outgoing: opts.outgoing ?? [],
    incoming: opts.incoming ?? [],
  } as never);
  if (opts.consentsFail) share.listConsents.mockRejectedValue(new Error("down"));
  share.listCompanions.mockResolvedValue({ companions: [], linkableUsers: [] } as never);
  cmp.people.mockResolvedValue({
    people: opts.people ?? [],
    requests: opts.requests ?? [],
    boards: [],
  } as never);
  conns.list.mockResolvedValue((opts.connections ?? []) as never);
  remote.status.mockResolvedValue({ available: true } as never);
  remote.listPeople.mockResolvedValue([]);
  remote.listServers.mockResolvedValue([]);
  return render(
    <MemoryRouter>
      <PeopleSection />
    </MemoryRouter>
  );
}

const switches = async (key: string) => within(await screen.findByTestId(`person-switches-${key}`));

beforeEach(() => {
  vi.clearAllMocks();
  beta.clear();
});

describe("PeopleSection", () => {
  it("shows a companion and the account linked to it as ONE row", async () => {
    setup({
      companions: [companion({ linkedUser: jonasAccount })],
      outgoing: [consent({})],
    });
    expect(await screen.findByText("Jonas")).toBeTruthy();
    expect(screen.queryByText("Jonas K.")).toBeNull();
    expect(
      screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("Jonas"))
    ).toHaveLength(1);
    expect(screen.getByText(/sharing:friends\.status\.connected/)).toBeTruthy();
  });

  it("asks for the share consent when 'Reisen teilen' is switched on", async () => {
    share.requestConsent.mockResolvedValue(consent({ status: "pending" }) as never);
    setup({ companions: [companion({ linkedUser: jonasAccount })] });
    const row = await switches("c:c1");
    await userEvent.click(row.getByRole("switch", { name: /switches\.share\.label/ }));
    await waitFor(() => expect(share.requestConsent).toHaveBeenCalledWith("jonas"));
  });

  it("withdraws the share consent after a question when it is switched off", async () => {
    share.answerConsent.mockResolvedValue(consent({ status: "withdrawn" }) as never);
    setup({ companions: [companion({ linkedUser: jonasAccount })], outgoing: [consent({})] });
    const row = await switches("c:c1");
    await userEvent.click(row.getByRole("switch", { name: /switches\.share\.label/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:friends.confirm.withdrawShareAction" })
    );
    await waitFor(() => expect(share.answerConsent).toHaveBeenCalledWith("k1", "withdraw"));
  });

  it("calls the leaderboard consent API from the 'sees my totals' switch", async () => {
    beta.add("comparison");
    cmp.request.mockResolvedValue({} as never);
    setup({ companions: [companion({ linkedUser: jonasAccount })] });
    const row = await switches("c:c1");
    await userEvent.click(row.getByRole("switch", { name: /switches\.totals\.label/ }));
    await userEvent.click(await screen.findByText("consent-dialog-confirm"));
    await waitFor(() =>
      expect(cmp.request).toHaveBeenCalledWith("jonas", { groups: [], domains: [], year: null })
    );
  });

  it("ends the leaderboard consent when 'sees my totals' is switched off", async () => {
    beta.add("comparison");
    cmp.end.mockResolvedValue({ ended: true });
    setup({
      companions: [companion({ linkedUser: jonasAccount })],
      outgoing: [consent({})],
      people: [
        {
          person: {
            key: "u:u1",
            kind: "local",
            username: "jonas",
            displayName: "Jonas K.",
            origin: null,
          },
          mine: {
            consentId: "m1",
            status: "accepted",
            scope: { groups: [], domains: [], year: null },
          },
          theirs: null,
        },
      ],
    });
    const row = await switches("c:c1");
    await userEvent.click(row.getByRole("switch", { name: /switches\.totals\.label/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:friends.confirm.totalsOffAction" })
    );
    await waitFor(() => expect(cmp.end).toHaveBeenCalledWith("u:u1"));
  });

  it("has the leaderboard switch with the beta flag off (comparison is out of beta, 2.8), but not the encrypted one", async () => {
    setup({ companions: [companion({ linkedUser: jonasAccount })], outgoing: [consent({})] });
    const row = await switches("c:c1");
    expect(row.getByRole("switch", { name: /switches\.share\.label/ })).toBeTruthy();
    expect(row.getByRole("switch", { name: /switches\.totals\.label/ })).toBeTruthy();
    expect(row.queryByRole("switch", { name: /encrypted/ })).toBeNull();
    expect(comp.manage).toHaveBeenCalled();
    expect(cmp.people).toHaveBeenCalled();
  });

  it("lists a pending incoming request on top and answers it", async () => {
    share.answerConsent.mockResolvedValue(consent({ status: "accepted" }) as never);
    setup({
      incoming: [
        consent({
          id: "in1",
          status: "pending",
          person: { id: "u9", username: "mia", displayName: "Mia" },
        }),
      ],
    });
    const requests = within(await screen.findByTestId("people-requests"));
    await userEvent.click(
      requests.getByRole("button", { name: "sharing:friends.requests.accept" })
    );
    await waitFor(() => expect(share.answerConsent).toHaveBeenCalledWith("in1", "accept"));
    await userEvent.click(
      requests.getByRole("button", { name: "sharing:friends.requests.decline" })
    );
    await waitFor(() => expect(share.answerConsent).toHaveBeenCalledWith("in1", "decline"));
  });

  // Sharing UAT 2: the owner's companion "Norbert Wittke", linked to his father's account on
  // another server, was listed twice — "kein Konto" and the connection.
  it("shows a companion linked to a person on another server as ONE row", async () => {
    beta.add("federatedTripSharing");
    setup({
      companions: [companion({ name: "Norbert", linkedRemoteId: "cn9" })],
      connections: [
        {
          id: "cn9",
          origin: "https://far.example.org",
          username: "norbert",
          displayName: "Norbert W.",
          state: "active",
          mine: {
            plans: false,
            stats: "off",
            achievements: false,
            leaderboard: false,
            tripOffers: true,
          },
          theirs: {
            plans: false,
            stats: "off",
            achievements: false,
            leaderboard: false,
            tripOffers: true,
          },
        },
      ],
    });
    expect(await screen.findByText("Norbert")).toBeTruthy();
    expect(screen.queryByText("Norbert W.")).toBeNull();
    expect(
      screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("Norbert"))
    ).toHaveLength(1);
    expect(screen.getByText(/friends\.account\.remote/)).toBeTruthy();
  });

  it("accepts and declines a request from a person on another server", async () => {
    conns.accept.mockResolvedValue({} as never);
    conns.decline.mockResolvedValue({} as never);
    beta.add("federatedTripSharing");
    setup({
      connections: [
        {
          id: "cn1",
          origin: "https://far.example.org",
          username: "ben",
          displayName: "Ben",
          state: "pending_in",
        },
      ],
    });
    const requests = within(await screen.findByTestId("people-requests"));
    await userEvent.click(
      requests.getByRole("button", { name: "sharing:friends.requests.accept" })
    );
    await waitFor(() => expect(conns.accept).toHaveBeenCalledWith("cn1", expect.any(Object)));
    await userEvent.click(
      requests.getByRole("button", { name: "sharing:friends.requests.decline" })
    );
    await waitFor(() => expect(conns.decline).toHaveBeenCalledWith("cn1"));
  });

  it("draws the one field for a person on another server only where the server offers it", async () => {
    beta.add("federatedTripSharing");
    setup({});
    expect(await screen.findByTestId("remote-person-field")).toBeTruthy();
  });

  it("says which source failed to load and logs it", async () => {
    setup({ companions: [companion({})], consentsFail: true });
    expect(await screen.findByText("sharing:friends.loadFailed.accounts")).toBeTruthy();
    expect(screen.getByText("Jonas")).toBeTruthy();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("says a failed share request instead of staying silent", async () => {
    share.requestConsent.mockRejectedValue(new Error("nope"));
    setup({ companions: [companion({ linkedUser: jonasAccount })] });
    const row = await switches("c:c1");
    await userEvent.click(row.getByRole("switch", { name: /switches\.share\.label/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("offers 'delete unused people' as a link under the list", async () => {
    setup({ companions: [companion({ id: "c2", name: "Nobody", inUse: false, uses: {} })] });
    expect(await screen.findByTestId("delete-unused-link")).toBeTruthy();
  });

  it("says an unlinked person's missing account once: no pill, no sentence, no switches", async () => {
    setup({ companions: [companion({ id: "c2", name: "Ilka" })] });
    const rowEl = (await screen.findByText("Ilka")).closest("li")!;
    expect(within(rowEl).getAllByText("sharing:friends.account.none")).toHaveLength(1);
    expect(within(rowEl).queryByRole("switch")).toBeNull();
    expect(within(rowEl).queryByText(/status\./)).toBeNull();
  });

  it("marks only an open request with a pill", async () => {
    setup({
      companions: [companion({ linkedUser: jonasAccount })],
      outgoing: [consent({ status: "pending" })],
    });
    expect(await screen.findByText("sharing:friends.status.requested")).toBeTruthy();
  });

  it("keeps link, rename, merge and delete behind one menu per row", async () => {
    setup({ companions: [companion({ id: "c2", name: "Ilka", inUse: false })] });
    expect(screen.queryByRole("button", { name: "companions:manage.actions.rename" })).toBeNull();
    await userEvent.click(await screen.findByTestId("person-menu-c:c2"));
    const menu = within(await screen.findByRole("menu"));
    for (const label of [
      "sharing:friends.actions.linkAccount",
      "companions:manage.actions.rename",
      "companions:manage.actions.merge",
      "companions:manage.actions.delete",
    ])
      expect(menu.getByRole("menuitem", { name: label })).toBeTruthy();
  });

  it("never attaches an encrypted hand-over to a person; only a quiet link manages them", async () => {
    beta.add("encryptedShare");
    setup({ companions: [companion({ linkedUser: jonasAccount })], outgoing: [consent({})] });
    const row = await switches("c:c1");
    expect(row.queryByRole("switch", { name: /encrypted/ })).toBeNull();
    expect(screen.getByText("sharing:friends.encryptedManage")).toBeTruthy();
  });

  it("does not send a remote person's username to the local leaderboard API", async () => {
    beta.add("comparison");
    beta.add("federatedTripSharing");
    // A local account called "ben" exists too; the remote ben must never reach it.
    setup({
      outgoing: [consent({ person: { id: "u7", username: "ben", displayName: "Ben local" } })],
      connections: [
        {
          id: "cn1",
          origin: "https://far.example.org",
          username: "ben",
          displayName: "Ben remote",
          state: "active",
          mine: {
            plans: false,
            stats: "off",
            achievements: false,
            leaderboard: false,
            tripOffers: false,
          },
          theirs: {
            plans: false,
            stats: "off",
            achievements: false,
            leaderboard: false,
            tripOffers: false,
          },
        },
      ],
    });
    const remoteRow = await switches("r:cn1");
    expect(remoteRow.queryByRole("switch", { name: /switches\.totals\.label/ })).toBeNull();
    expect(cmp.request).not.toHaveBeenCalled();
  });

  it("keeps an accepted INCOMING share on a row, with a withdraw in the menu", async () => {
    share.answerConsent.mockResolvedValue(consent({ status: "withdrawn" }) as never);
    setup({ incoming: [consent({ id: "in7", status: "accepted" })] });
    await userEvent.click(await screen.findByTestId("person-menu-i:u1"));
    await userEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "sharing:friends.actions.withdrawIncoming",
      })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "sharing:friends.confirm.withdrawIncomingAction" })
    );
    await waitFor(() => expect(share.answerConsent).toHaveBeenCalledWith("in7", "withdraw"));
  });

  it("does not conflate usernames that differ only in case", async () => {
    beta.add("comparison");
    const view = (name: string, key: string) => ({
      person: { key, kind: "local", username: name, displayName: name, origin: null },
      mine: {
        consentId: `m-${key}`,
        status: "accepted",
        scope: { groups: [], domains: [], year: null },
      },
      theirs: null,
    });
    setup({
      companions: [
        companion({ linkedUser: { id: "u1", username: "Alice", displayName: "Alice" } }),
      ],
      people: [view("alice", "u:other")],
    });
    const row = await switches("c:c1");
    // The comparison consent belongs to the account "alice", not to "Alice": this row has none.
    expect(row.getByRole("switch", { name: /switches\.totals\.label/ })).toHaveProperty(
      "checked",
      false
    );
  });
});
