import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import TripModal from "../TripModal";
import type { Trip } from "../../../types";

/**
 * SRV-TRIP-DATE-001 (audit 2026-09-20): this form saved a trip running
 * 10.08.2025 to 01.08.2025 with a PATCH 200, and Web and Companion then both
 * drew "10. – 1. August 2025". The server refuses the span now; the form has
 * to say WHICH field is wrong rather than letting the request go and raising
 * a generic "could not save" toast.
 */

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn() }));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("../../../lib/api", () => ({
  tripsApi: { update: mocks.update, create: mocks.create },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const trip: Trip = {
  id: "t1",
  userId: "u1",
  name: "Sommer",
  color: "#818cf8",
  startDate: "2025-08-10T00:00:00.000Z",
  endDate: "2025-08-12T00:00:00.000Z",
  tags: [],
  companions: [],
  createdAt: "2025-01-01T00:00:00.000Z",
} as unknown as Trip;

function dateInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
}

function saveButton(): HTMLButtonElement {
  return screen.getByText("trips:modal.save").closest("button") as HTMLButtonElement;
}

describe("TripModal — an end before the start (SRV-TRIP-DATE-001)", () => {
  beforeEach(() => {
    mocks.update.mockReset().mockResolvedValue(trip);
    mocks.create.mockReset().mockResolvedValue(trip);
  });

  it("names the offending field and refuses to save", () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);
    const [, end] = dateInputs();

    fireEvent.change(end, { target: { value: "2025-08-01" } });

    expect(screen.getByText("trips:modal.endBeforeStart")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(saveButton());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears the message and saves again once the span is in order", () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);
    const [, end] = dateInputs();

    fireEvent.change(end, { target: { value: "2025-08-01" } });
    fireEvent.change(end, { target: { value: "2025-08-12" } });

    expect(screen.queryByText("trips:modal.endBeforeStart")).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it("accepts a one-day trip — same day is a span, not an inversion", () => {
    render(<TripModal trip={trip} onClose={vi.fn()} onSaved={vi.fn()} />);
    const [, end] = dateInputs();

    fireEvent.change(end, { target: { value: "2025-08-10" } });

    expect(screen.queryByText("trips:modal.endBeforeStart")).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });
});
