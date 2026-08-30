import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * L2 (fix round 1 review, 2026-08-30): the year filter select had no
 * effect on the tour tab (`useDashboardTours` takes no date param) but
 * rendered fully functional-looking regardless -- a control that visibly
 * does nothing. Fixed by hiding the whole Filter section (year select +
 * domain pills + reset) on the tour tab; the Modus section stays, since
 * routes/globe both actually work there.
 */

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi"],
    isEnabled: () => true,
  }),
}));

// Imported after the mocks above so the module graph picks them up.
import { MapChromeSections } from "../MapChromeSections";

function renderAt(tab: string, mode: string): ReturnType<typeof render> {
  mockUseDashboardRoute.mockReturnValue({ tab, mode, setTab: vi.fn(), setMode: vi.fn() });
  return render(<MapChromeSections />);
}

describe("MapChromeSections: the Filter section on the tour tab", () => {
  it("hides the year filter entirely on the tour tab", () => {
    renderAt("tour", "routes");
    expect(screen.queryByText("dashboard:filter.title")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard:filter.year")).not.toBeInTheDocument();
  });

  it("still offers the Modus section on the tour tab", () => {
    renderAt("tour", "routes");
    expect(screen.getByText("dashboard:controls.mode")).toBeInTheDocument();
  });

  it("keeps the year filter on a real domain tab (flight)", () => {
    renderAt("flight", "routes");
    expect(screen.getByText("dashboard:filter.title")).toBeInTheDocument();
    expect(screen.getByText("dashboard:filter.year")).toBeInTheDocument();
  });
});
