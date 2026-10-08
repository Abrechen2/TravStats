import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LodgingStatusTag } from "../LodgingStatusTag";
import type { Lodging } from "../../../types/lodging";

const unlocated = {
  id: "l1",
  name: "Hotel Adlon",
  address: "Unter den Linden 77",
  city: "Berlin",
  country: "DE",
  lat: null,
  lon: null,
} as unknown as Lodging;

describe("LodgingStatusTag", () => {
  // forgejo#249: the explanation of an issue was a hover-only `title`.
  it("carries the explanation as text a screen reader gets, not only as a hover title", () => {
    render(<LodgingStatusTag lodging={{ ...unlocated, lat: 1, lon: 2, address: null }} />);
    expect(screen.getByText("lodging:list.status.noAddressHint")).toHaveClass("sr-only");
  });

  it("the repair button is described by the explanation", () => {
    render(<LodgingStatusTag lodging={unlocated} onRepair={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAccessibleDescription(
      "lodging:list.status.unlocatedHint"
    );
  });
});
