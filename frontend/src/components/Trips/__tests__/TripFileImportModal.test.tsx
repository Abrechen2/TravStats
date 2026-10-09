import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TripFileImportModal, tripFileFailureKey } from "../TripFileImportModal";
import type { TripFileProposal } from "../../../lib/api/tripExchange";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

const preview = vi.fn();
const commit = vi.fn();
vi.mock("../../../lib/api/tripExchange", () => ({
  tripExchangeApi: {
    preview: (...args: unknown[]) => preview(...args),
    commit: (...args: unknown[]) => commit(...args),
  },
}));

const file = new File(["zip"], "lissabon.travstats");

const proposal = (overrides: Partial<TripFileProposal> = {}): TripFileProposal => ({
  trip: {
    action: "create",
    id: null,
    name: "Lissabon & Atlantik",
    startDate: "2026-05-01",
    endDate: "2026-05-12",
    matchedBy: null,
  },
  options: { documents: true, photos: false, private: false },
  exportedAt: "2026-10-09T10:00:00.000Z",
  appVersion: "2.7.0",
  bookings: [
    { key: "b1", action: "create", id: null, reference: "TSX123", price: 1800, currency: "EUR" },
  ],
  places: [],
  entries: [
    {
      key: "f1",
      kind: "flight",
      action: "create",
      id: null,
      label: "TP579 FRA–LIS",
      day: "2026-05-01",
    },
    {
      key: "s1",
      kind: "stay",
      action: "skip",
      id: "stay-1",
      reason: "onOtherTrip",
      label: "Hotel Tejo",
      day: "2026-05-01",
    },
  ],
  journal: { create: 0, skip: 0 },
  documents: { create: 1, skip: 0 },
  photos: { create: 0, skip: 0 },
  ...overrides,
});

describe("TripFileImportModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue(proposal());
  });

  const renderModal = (onSaved = vi.fn()) =>
    render(<TripFileImportModal file={file} onCancel={vi.fn()} onSaved={onSaved} />);

  it("shows per entry what will be created and what is skipped and why", async () => {
    renderModal();
    expect(await screen.findByText("TP579 FRA–LIS")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(file);
    const rows = screen.getAllByTestId("trip-file-entry").map((r) => r.textContent);
    expect(rows[0]).toContain("Flug");
    expect(rows[0]).toContain("Neu");
    expect(rows[1]).toContain("Übersprungen · gehört zu einer anderen Reise");
    expect(screen.getByText(/In der Datei: Dokumente/)).toBeInTheDocument();
    expect(screen.getByText("Dokumente: 1 neu, 0 schon vorhanden")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Lissabon & Atlantik")).toBeInTheDocument();
  });

  it("commits the file with the reviewer's trip name and reports success", async () => {
    const result = { tripId: "t1", created: 1, attached: 0, skipped: 1 };
    commit.mockResolvedValue(result);
    const onSaved = vi.fn();
    renderModal(onSaved);
    fireEvent.change(await screen.findByDisplayValue("Lissabon & Atlantik"), {
      target: { value: "Portugal 2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reise übernehmen" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
    expect(commit).toHaveBeenCalledWith(file, "Portugal 2026");
  });

  it("says when everything in the file is already there", async () => {
    preview.mockResolvedValue(
      proposal({
        trip: { ...proposal().trip, action: "attach", id: "t1", matchedBy: "bookingReference" },
        entries: proposal().entries.map((e) => ({ ...e, action: "skip", reason: "duplicate" })),
        documents: { create: 0, skip: 1 },
      })
    );
    renderModal();
    expect(
      await screen.findByText("Alles aus dieser Datei ist schon vorhanden.")
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Lissabon & Atlantik")).not.toBeInTheDocument();
  });

  it("shows a refused file as itself and offers no commit", async () => {
    preview.mockRejectedValue({
      response: { status: 422, data: { code: "TRIP_FILE_VERSION_UNSUPPORTED", error: "x" } },
    });
    renderModal();
    expect(await screen.findByRole("alert")).toHaveTextContent("neueren TravStats-Version");
    expect(screen.getByRole("button", { name: "Reise übernehmen" })).toBeDisabled();
  });

  it("keeps the dialog open and never reports saved when the commit fails", async () => {
    commit.mockRejectedValue({ response: { status: 500, data: {} } });
    const onSaved = vi.fn();
    renderModal(onSaved);
    await screen.findByText("TP579 FRA–LIS");
    fireEvent.click(screen.getByRole("button", { name: "Reise übernehmen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Es wurde nichts übernommen");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reise übernehmen" })).toBeEnabled();
  });

  it("names every refusal code the server sends", () => {
    const err = (code: string, status = 422) => ({ response: { status, data: { code } } });
    expect(tripFileFailureKey(err("TRIP_FILE_INVALID"), "preview")).toBe("invalid");
    expect(tripFileFailureKey(err("TRIP_FILE_TOO_LARGE", 413), "preview")).toBe("tooLarge");
    expect(tripFileFailureKey(err("TRIP_FILE_UNSAFE_PATH"), "preview")).toBe("unsafe");
    expect(tripFileFailureKey({ response: { status: 413, data: {} } }, "preview")).toBe("tooLarge");
    expect(tripFileFailureKey({ response: { status: 429, data: {} } }, "commit")).toBe(
      "rateLimited"
    );
    expect(tripFileFailureKey(new Error("network"), "commit")).toBe("commit");
  });
});
