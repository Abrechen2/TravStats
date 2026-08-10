import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { DashboardEmptyState } from "../DashboardEmptyState";

const renderIt = (onAddFlight = vi.fn()): { onAddFlight: ReturnType<typeof vi.fn> } => {
  render(
    <MemoryRouter>
      <DashboardEmptyState onAddFlight={onAddFlight} />
    </MemoryRouter>
  );
  return { onAddFlight };
};

describe("DashboardEmptyState (#237)", () => {
  beforeEach(() => navigate.mockReset());

  // Import is the point of the whole card — the most valuable action for a
  // user arriving with existing travel history.
  it("routes to the import section, deep-linked", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "dashboard:empty.import" }));
    expect(navigate).toHaveBeenCalledWith("/settings?section=import");
  });

  it("opens the add-flight flow via the callback, not a navigation", () => {
    const { onAddFlight } = renderIt();
    fireEvent.click(screen.getByRole("button", { name: "dashboard:empty.addFlight" }));
    expect(onAddFlight).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("routes to the modules section to choose domains", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "dashboard:empty.chooseDomains" }));
    expect(navigate).toHaveBeenCalledWith("/settings?section=modules");
  });
});
