import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GuestPlanPage, { phonePayload } from "../GuestPlanPage";

const mocks = vi.hoisted(() => ({ session: vi.fn(), pairingCode: vi.fn() }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/api/travplanGuests", () => ({
  travplanGuestsApi: { session: mocks.session, pairingCode: mocks.pairingCode },
}));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));
vi.mock("../../TravPlan/PlanContent", () => ({
  default: () => <div>plan</div>,
  PLAN_SECTIONS: ["overview"],
}));

const TRIP = "11111111-1111-4111-8111-111111111111";

describe("GuestPlanPage — phone pairing by claim code (forgejo#404)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({
      planId: "p1",
      tripId: TRIP,
      planName: "Plan",
      hostName: "Anna's TravStats",
      ownerName: "Anna",
      expiresAt: "2030-01-01T00:00:00.000Z",
      memberId: "m1",
      displayName: "Bob",
      origin: "https://guest.example",
      credential: "session",
    });
  });

  it("puts a claim code, never a live phone token, into the QR as in-app JSON", async () => {
    mocks.pairingCode.mockResolvedValue({
      code: "ABCDE23456",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    render(
      <MemoryRouter initialEntries={[`/guest/plan/${TRIP}`]}>
        <Routes>
          <Route path="/guest/plan/:tripId" element={<GuestPlanPage />} />
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(await screen.findByText("guests.phone.open"));
    const qr = (await screen.findByTestId("qr")).textContent ?? "";
    expect(qr).not.toMatch(/travstats:\/\/|ts_gpat_/);
    expect(JSON.parse(qr)).toEqual({
      v: 1,
      k: "guest",
      u: window.location.origin,
      p: "p1",
      c: "ABCDE23456",
      n: "Anna's TravStats",
    });
    expect(screen.getByText("guests.phone.expires")).toBeInTheDocument();
  });

  it("builds the documented payload", () => {
    expect(JSON.parse(phonePayload("https://h", "p", "C", "H"))).toEqual({
      v: 1,
      k: "guest",
      u: "https://h",
      p: "p",
      c: "C",
      n: "H",
    });
  });
});
