import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const markMock = vi.fn();
vi.mock("../../../lib/api/operators", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/api/operators")>();
  return { ...actual, getOperatorMark: (...a: unknown[]) => markMock(...a) };
});

import { OperatorMarkTile } from "../OperatorMarkTile";

describe("OperatorMarkTile", () => {
  it("shows the operator's logo once the service says there is one", async () => {
    markMock.mockResolvedValue({ available: true, source: "wikidata", credit: null });
    render(<OperatorMarkTile name="Stena Line" domain="ferry" />);
    const logo = await screen.findByTestId("operator-logo");
    expect(logo.getAttribute("src")).toBe("/api/v1/operators/logo?domain=ferry&name=Stena%20Line");
  });

  it("keeps the monogram when there is no logo, never an empty box", async () => {
    markMock.mockResolvedValue({ available: false, source: null, credit: null });
    render(<OperatorMarkTile name="Stena Line" domain="ferry" />);
    await waitFor(() => expect(markMock).toHaveBeenCalled());
    expect(screen.queryByTestId("operator-logo")).toBeNull();
    expect(screen.getByText("SL")).toBeInTheDocument();
  });

  it("asks nothing for a ride with no operator and shows the domain icon", () => {
    markMock.mockClear();
    render(<OperatorMarkTile name={null} domain="bus" />);
    expect(markMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("operator-tile")).toBeInTheDocument();
  });
});
