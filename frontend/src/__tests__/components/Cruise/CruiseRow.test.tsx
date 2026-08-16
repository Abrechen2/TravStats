import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CruiseRow } from "../../../components/Cruise/CruiseRow";
import type { Cruise, CruiseStop, Port } from "../../../types";

// Same mock pattern as CruiseEditModal.test.tsx: t(key) => key, so assertions
// below check for the i18n KEY rather than the German sentence it resolves
// to at runtime. The real translation is exercised by the i18n resource
// files themselves (both locales carry `list.unresolvedPorts`), not by this
// render test.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

const port = (id: number, name: string): Port => ({
  id,
  name,
  city: null,
  country: null,
  unlocode: null,
  lat: 0,
  lon: 0,
  timezone: null,
  region: null,
  isUserAdded: false,
});

const stop = (id: string, p: Port | null, isAtSea: boolean, dayNumber: number): CruiseStop => ({
  id,
  cruiseId: "c1",
  portId: p?.id ?? null,
  port: p,
  dayNumber,
  date: null,
  isAtSea,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: null,
});

const baseCruise = (overrides: Partial<Cruise>): Cruise =>
  ({
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2025-08-10T16:00:00.000Z",
    endDate: "2025-08-17T06:00:00.000Z",
    status: "scheduled",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }) as Cruise;

const HAMBURG = port(1, "Hamburg");
const SOUTHAMPTON = port(2, "Southampton");

// CruiseRow renders a <tr> — it must be wrapped in <table><tbody> or React
// warns about invalid DOM nesting, and a warning in test output is itself a
// finding per this dispatch.
const renderRow = (cruise: Cruise) =>
  render(
    <table>
      <tbody>
        <CruiseRow cruise={cruise} onOpen={() => {}} />
      </tbody>
    </table>
  );

describe("CruiseRow", () => {
  it("shows the identifiable port count plus a (+1) badge for two unresolved stops sharing a name", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: null,
      stops: [
        stop("s1", SOUTHAMPTON, false, 1),
        { ...stop("s2", null, false, 2), unresolvedPortName: "Taranto" },
        { ...stop("s3", null, false, 3), unresolvedPortName: " taranto " },
      ],
    });
    const { container } = renderRow(cruise);

    // Hamburg (departure) + Southampton (port-call) = 2 identifiable ports.
    // The two unresolved stops de-dupe (trimmed + case-folded) to one badge.
    expect(container.textContent).toContain("2");
    expect(screen.getByText("(+1)")).toBeInTheDocument();
  });

  it("gives the (+n) badge a non-empty aria-label", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      stops: [{ ...stop("s1", null, false, 1), unresolvedPortName: "Taranto" }],
    });
    renderRow(cruise);

    const badge = screen.getByText("(+1)");
    const ariaLabel = badge.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toBe(badge.getAttribute("title"));
  });

  it("renders no (+n) badge when there are no unresolved stops", () => {
    const cruise = baseCruise({
      departurePort: HAMBURG,
      arrivalPort: SOUTHAMPTON,
      stops: [],
    });
    const { container } = renderRow(cruise);

    expect(container.textContent).not.toMatch(/\(\+\d+\)/);
  });
});
