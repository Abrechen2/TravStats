import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.count !== undefined ? `${k}/${String(o.count)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/rail/StationPicker", () => ({
  StationPicker: ({ label }: { label: string }) => <span>picker {label}</span>,
}));
const readBahnHandoff = vi.fn();
const create = vi.fn();
vi.mock("../../lib/api/rail", () => ({
  railApi: {
    readBahnHandoff: (...a: unknown[]) => readBahnHandoff(...a),
    create: (...a: unknown[]) => create(...a),
  },
}));
const addToast = vi.fn();
vi.mock("../../store/toastStore", () => ({
  useToastStore: (pick: (s: { addToast: typeof addToast }) => unknown) => pick({ addToast }),
}));

import RailBahnHandoffPage from "../RailBahnHandoffPage";
import { HomeRedirect } from "../railHandoffRoutes";
import { stashBahnHandoff } from "../../lib/rail/bahnHandoff";
import { booking, leg, station } from "../../components/rail/__tests__/railImportFixture";

const RECON =
  "¶HKI¶T$A=1@O=Augsburg Hbf@L=8000013@a=128@$A=1@O=München Hbf@L=8000261@a=128@" +
  "$202611030808$202611030854$RB 57099$$1$$$$$$¶KC¶";
const HASH = `#d=${encodeURIComponent(JSON.stringify({ v: 1, answer: { hinfahrtRecon: RECON } }))}`;
const NO_FACTS = {
  departureStationName: null,
  arrivalStationName: null,
  departureLocal: null,
  travelClass: null,
};

/** The page as the bookmarklet opens it: the hand-over in the real address's fragment. */
function arrive(hash: string) {
  window.history.replaceState(null, "", `/rail/from-bahn${hash}`);
  return render(
    <MemoryRouter initialEntries={[`/rail/from-bahn${hash}`]}>
      <Routes>
        <Route path="/rail/from-bahn" element={<RailBahnHandoffPage />} />
        <Route path="/rail" element={<p>rail logbook</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const handedOver = () =>
  booking({
    bookingReference: null,
    price: null,
    currency: null,
    source: "db-share-link",
    legs: [
      leg({
        depStationName: "Augsburg Hbf",
        arrStationName: "München Hbf",
        departureLocal: "2026-11-03T08:08",
        arrivalLocal: "2026-11-03T08:54",
        trainCategory: "RB",
        trainNumber: "57099",
        direction: null,
        departureStation: station("Augsburg Hbf", true, 1),
        arrivalStation: station("München Hbf", true, 2),
      }),
    ],
  });

describe("RailBahnHandoffPage (forgejo#204)", () => {
  beforeEach(() => {
    readBahnHandoff.mockReset();
    create.mockReset();
    addToast.mockReset();
  });
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("opens the rail review with the handed-over ride, and saves only on the user's word", async () => {
    readBahnHandoff.mockResolvedValue({ outcome: "read", facts: NO_FACTS, booking: handedOver() });
    create.mockResolvedValue({ journey: { id: "new-1" }, geometry: null });
    arrive(HASH);

    expect(await screen.findByRole("button", { name: /rail:import.save/ })).toBeInTheDocument();
    expect(readBahnHandoff).toHaveBeenCalledTimes(1);
    expect(readBahnHandoff).toHaveBeenCalledWith({ hinfahrtRecon: RECON });
    expect(create).not.toHaveBeenCalled();
    // The ride is out of the address at once: no reload or history entry imports it again.
    expect(sessionStorage.length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /rail:import.save/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ trainNumber: "57099", price: null });
    expect(await screen.findByText("rail logbook")).toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith("success", "rail:import.saved/1");
  });

  it("names a tampered hand-over without asking the server", async () => {
    arrive("#d=%7B%22v%22%3A1%2C%22answer%22%3A%22%3Cscript%3E%22%7D");
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:bahnHandoff.reason.damaged");
    expect(readBahnHandoff).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "rail:bahnHandoff.toSetup" })).toBeInTheDocument();
  });

  it("names what the bookmarklet reported on bahn.de", async () => {
    arrive("#e=blocked");
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:bahnHandoff.reason.blocked");
    expect(readBahnHandoff).not.toHaveBeenCalled();
  });

  it("names a connection without a train, and the server's own refusal", async () => {
    readBahnHandoff.mockResolvedValueOnce({
      outcome: "failed",
      reason: "noTrain",
      facts: NO_FACTS,
    });
    const first = arrive(HASH);
    expect(await screen.findByRole("alert")).toHaveTextContent("rail:bahnHandoff.reason.noTrain");
    first.unmount();

    readBahnHandoff.mockRejectedValueOnce(
      Object.assign(new Error("429"), { response: { status: 429 } })
    );
    arrive(HASH);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "rail:bahnHandoff.reason.requestRateLimited"
    );
  });

  it("keeps the hand-over when the session ran out on the way, for after the login", async () => {
    readBahnHandoff.mockRejectedValueOnce(
      Object.assign(new Error("401"), { response: { status: 401 } })
    );
    arrive(HASH);
    await screen.findByRole("alert");
    expect(sessionStorage.length).toBe(1);
  });

  it("reads a hand-over that waited through the login", async () => {
    stashBahnHandoff(HASH, Date.now());
    readBahnHandoff.mockResolvedValue({ outcome: "read", facts: NO_FACTS, booking: handedOver() });
    arrive("");
    expect(await screen.findByRole("button", { name: /rail:import.save/ })).toBeInTheDocument();
    expect(readBahnHandoff).toHaveBeenCalledWith({ hinfahrtRecon: RECON });
  });
});

describe("HomeRedirect", () => {
  afterEach(() => sessionStorage.clear());

  const land = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
          <Route path="/rail/from-bahn" element={<p>hand-over</p>} />
        </Routes>
      </MemoryRouter>
    );

  it("sends a fresh login to a waiting hand-over, else to the dashboard", () => {
    const plain = land();
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    plain.unmount();
    stashBahnHandoff("#e=blocked", Date.now());
    land();
    expect(screen.getByText("hand-over")).toBeInTheDocument();
  });
});
