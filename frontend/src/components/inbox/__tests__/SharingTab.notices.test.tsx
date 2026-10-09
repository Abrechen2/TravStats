import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import SharingTab from "../SharingTab";
import { sharingApi } from "../../../lib/api/sharing";
import type { ShareNotice } from "../../../types/sharing";

/**
 * Trip sharing S2 in the inbox: a change notice lists every changed fact with
 * old and new value (times on the place's clock), undo calls the server and
 * reloads, a refused undo is shown on the notice naming what changed since,
 * and a delete notice offers deleting the own copy.
 */

// Interpolation visible: the sentence must carry the fields it names.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "fields" in options ? `${key} [${String(options.fields)}]` : key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      isInitialized: true,
    },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("../../../lib/api/sharing", () => ({
  sharingApi: {
    listConsents: vi.fn(),
    listNotices: vi.fn(),
    answerConsent: vi.fn(),
    markNoticeRead: vi.fn(),
    undoNotice: vi.fn(),
    deleteOwnCopy: vi.fn(),
  },
}));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

const api = vi.mocked(sharingApi);
const anna = { id: "u-anna", username: "anna", displayName: "Anna" };

const updated: ShareNotice = {
  id: "n-up",
  kind: "updated",
  entityType: "flight",
  entityKey: null,
  after: { label: "TP571 FRA → LIS", tripId: "trip-1", entryId: "f-1" },
  createdAt: "2026-10-09T10:05:00.000Z",
  readAt: null,
  undoneAt: null,
  actor: anna,
  changes: [
    { field: "gate", before: { kind: "empty" }, after: { kind: "text", value: "B12" } },
    {
      field: "departureTime",
      before: {
        kind: "time",
        value: {
          utc: "2025-05-01T06:00:00.000Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2025-05-01T08:00:00",
          precision: "minute",
        },
      },
      after: {
        kind: "time",
        value: {
          utc: "2025-05-01T08:30:00.000Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2025-05-01T10:30:00",
          precision: "minute",
        },
      },
    },
  ],
};

const deleted: ShareNotice = {
  ...updated,
  id: "n-del",
  kind: "deleted",
  after: { label: "Hotel Avenida Palace", tripId: "trip-1", entryId: "s-1", reason: "deleted" },
  entityType: "lodgingStay",
  changes: [],
};

function renderTab() {
  render(
    <MemoryRouter>
      <SharingTab />
    </MemoryRouter>
  );
}

describe("SharingTab — change notices (S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConsents.mockResolvedValue({ incoming: [], outgoing: [] });
    api.listNotices.mockResolvedValue([updated, deleted]);
  });

  it("lists what changed, old and new, the time on the place's clock", async () => {
    renderTab();
    const [row] = await screen.findAllByTestId("share-notice");
    const changes = within(row).getAllByTestId("share-change");
    expect(changes).toHaveLength(2);
    expect(changes[0].textContent).toContain("—");
    expect(changes[0].textContent).toContain("B12");
    // The wall clock at the airport, not the browser's zone.
    expect(changes[1].textContent).toContain("08:00");
    expect(changes[1].textContent).toContain("10:30");
    expect(within(row).getByRole("link")).toHaveProperty(
      "href",
      expect.stringContaining("/trips/trip-1")
    );
  });

  it("undoes a change and reloads", async () => {
    api.undoNotice.mockResolvedValue(undefined);
    renderTab();
    const [row] = await screen.findAllByTestId("share-notice");
    await userEvent.click(within(row).getByRole("button", { name: "sharing:inbox.notices.undo" }));
    expect(api.undoNotice).toHaveBeenCalledWith("n-up");
    await waitFor(() => expect(api.listNotices).toHaveBeenCalledTimes(2));
    expect(addToast).toHaveBeenCalledWith("success", "sharing:inbox.messages.undone");
  });

  it("shows a stale undo as itself, naming the fields that changed since", async () => {
    api.undoNotice.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_UNDO_STALE", fields: "gate,terminal" } },
    });
    renderTab();
    const [row] = await screen.findAllByTestId("share-notice");
    await userEvent.click(within(row).getByRole("button", { name: "sharing:inbox.notices.undo" }));
    const alert = await within(row).findByRole("alert");
    expect(alert.textContent).toContain("sharing:errors.undoStaleFields");
    expect(alert.textContent).toContain("sharing:fields.gate");
    expect(alert.textContent).toContain("sharing:fields.terminal");
  });

  it("shows any other refusal by its code, not as success", async () => {
    api.undoNotice.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: "SHARE_COPY_NOT_FOUND" } },
    });
    renderTab();
    const [row] = await screen.findAllByTestId("share-notice");
    await userEvent.click(within(row).getByRole("button", { name: "sharing:inbox.notices.undo" }));
    expect((await within(row).findByRole("alert")).textContent).toBe("sharing:errors.copyNotFound");
    expect(addToast).not.toHaveBeenCalledWith("success", expect.anything());
  });

  it("offers deleting the own copy after a delete — and no undo there", async () => {
    api.deleteOwnCopy.mockResolvedValue(undefined);
    renderTab();
    const rows = await screen.findAllByTestId("share-notice");
    const del = rows[1];
    expect(within(del).queryByRole("button", { name: "sharing:inbox.notices.undo" })).toBeNull();
    await userEvent.click(
      within(del).getByRole("button", { name: "sharing:inbox.notices.deleteCopy" })
    );
    expect(api.deleteOwnCopy).toHaveBeenCalledWith("n-del");
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("success", "sharing:inbox.messages.copyDeleted")
    );
  });
});
