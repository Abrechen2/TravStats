import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickStop, quickStopsFor } from "../QuickStop";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("QuickStop", () => {
  it("offers the dump station only to a camping vehicle", () => {
    expect(quickStopsFor("motorhome").map((s) => s.key)).toContain("service");
    expect(quickStopsFor("car").map((s) => s.key)).not.toContain("service");
    expect(quickStopsFor(null).map((s) => s.key)).not.toContain("service");
  });

  it("hands the picked stop over with its usual length", async () => {
    const onPick = vi.fn();
    render(<QuickStop vehicle="motorhome" busy={false} onPick={onPick} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "days.quickStop" }), "fuel");
    expect(onPick).toHaveBeenCalledWith("days.stop.fuel", 15);
  });
});
