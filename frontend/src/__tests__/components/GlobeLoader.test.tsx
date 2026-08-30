import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobeLoader } from "../../components/GlobeLoader";

const mockTopology = {
  type: "Topology",
  objects: {
    countries: { type: "GeometryCollection", geometries: [] },
  },
  arcs: [],
  transform: { scale: [1, 1], translate: [0, 0] },
};

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(mockTopology) })
  ) as unknown as typeof fetch;
});

describe("GlobeLoader", () => {
  it("renders with role=status and the provided aria-label", () => {
    render(<GlobeLoader label="Loading flights" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading flights");
  });

  it("falls back to a TRANSLATED default when no label is passed", () => {
    // Was pinned to the literal "Loading" — an English name on a German page.
    render(<GlobeLoader />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "common:accessibility.loading"
    );
  });

  it("renders the visible label when provided", () => {
    render(<GlobeLoader label="Loading flights" />);
    expect(screen.getByText("Loading flights")).toBeInTheDocument();
  });
});
