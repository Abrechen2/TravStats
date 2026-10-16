import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CountryCountingCard from "../CountryCountingCard";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CountryCountingCard", () => {
  it("explains the two fixed country sets instead of offering conflicting thresholds", () => {
    render(<CountryCountingCard />);
    expect(screen.getByText("passport:countingRule")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
